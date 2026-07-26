/**
 * Express security posture loaders.
 *
 * Covers:
 * - `trust proxy` hop configuration for deployments behind reverse proxies
 * - Helmet header policy (HSTS, CSP, frame deny, nosniff, …)
 * - Secure cookie defaults (documented for future session/JWT work)
 *
 * See `docs/SECURITY.md` § "HTTP security headers & proxy trust".
 */

import type { HelmetOptions } from "helmet";

/** Parsed trust-proxy setting for `app.set('trust proxy', …)`. */
export type TrustProxySetting = boolean | number | string;

export interface SecurityPosture {
  /** Value passed to `app.set('trust proxy', value)`. */
  trustProxy: TrustProxySetting;
  /** Helmet configuration applied as global middleware. */
  helmet: HelmetOptions;
  /**
   * Defaults to apply when the API starts issuing cookies (sessions/JWT).
   * The API is header-auth today and does not set cookies; these are the
   * required defaults if cookies are introduced.
   */
  cookieDefaults: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict" | "lax" | "none";
    path: string;
  };
}

/**
 * Parse `TRUST_PROXY` into an Express-compatible trust proxy setting.
 *
 * Accepted forms:
 * - unset / empty → `false` (direct client; safest local default)
 * - `true` / `1` / `yes` → `true` (trust first proxy hop)
 * - `false` / `0` / `no` → `false`
 * - integer hop count (e.g. `1`, `2`) → number of proxies to trust
 * - CIDR / IP / subnet string (e.g. `loopback`, `10.0.0.0/8`) → passed through
 *
 * Production deployments behind ALB/nginx/Cloudflare **must** set this so
 * rate-limit and request-IP logic see the real client address. Leaving it
 * false when a proxy is present lets clients spoof `X-Forwarded-For`.
 */
export function loadTrustProxy(
  env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || raw.trim() === "") {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  if (["true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "off"].includes(normalized)) {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }

  // Express accepts named presets (`loopback`, `linklocal`, `uniquelocal`)
  // and IP/CIDR strings. Pass through after trim.
  return raw.trim();
}

/**
 * Build Helmet options suitable for a JSON API that also serves Swagger UI.
 *
 * CSP allows self + inline script/style so `/docs` (swagger-ui-express)
 * continues to render. COEP is disabled because Swagger embeds assets that
 * break under a strict embedder policy. HSTS is only meaningful over TLS;
 * Helmet still emits the header so browsers remember it after the first
 * HTTPS hit (maxAge 180 days, includeSubDomains, no preload by default).
 */
export function loadHelmetOptions(
  env: NodeJS.ProcessEnv = process.env,
): HelmetOptions {
  const isProduction = (env.NODE_ENV ?? "development") === "production";

  return {
    // Keep HSTS on in all envs so header presence is testable; browsers
    // ignore it over plain HTTP. Production can raise maxAge via HSTS_MAX_AGE.
    hsts: {
      maxAge: parsePositiveInt(env.HSTS_MAX_AGE, 15_552_000), // 180 days
      includeSubDomains: true,
      preload: env.HSTS_PRELOAD === "true",
    },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // swagger-ui needs inline scripts/styles; API responses are JSON.
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "default-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    // API + Swagger are not cross-origin embeddable documents.
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    noSniff: true,
    // Referrer-Policy: avoid leaking path tokens to third parties.
    referrerPolicy: { policy: "no-referrer" },
    // X-DNS-Prefetch-Control off reduces incidental network side channels.
    dnsPrefetchControl: { allow: false },
    // Hide Express fingerprint.
    hidePoweredBy: true,
    // Only force HTTPS redirect header semantics in production.
    // (Helmet does not redirect; this documents intent via options shape.)
    ...(isProduction ? {} : {}),
  };
}

/**
 * Secure cookie defaults for any future cookie-based auth.
 * Not applied automatically — the API currently uses header auth only.
 */
export function loadCookieDefaults(
  env: NodeJS.ProcessEnv = process.env,
): SecurityPosture["cookieDefaults"] {
  const isProduction = (env.NODE_ENV ?? "development") === "production";
  return {
    httpOnly: true,
    secure: isProduction || env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
  };
}

/** Aggregate security posture for bootstrap. */
export function loadSecurityPosture(
  env: NodeJS.ProcessEnv = process.env,
): SecurityPosture {
  return {
    trustProxy: loadTrustProxy(env),
    helmet: loadHelmetOptions(env),
    cookieDefaults: loadCookieDefaults(env),
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
