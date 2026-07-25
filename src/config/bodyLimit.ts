/**
 * Per-endpoint request body size limits.
 *
 * Defaults keep typical JSON API traffic small (DoS resistance). Bulk and
 * other high-volume ingest routes can opt into a higher ceiling. The absolute
 * max is what `express.json` is configured with as a last-resort safety net
 * for chunked requests without Content-Length.
 *
 * Env vars (optional overrides, byte counts as integers):
 *   BODY_LIMIT_DEFAULT_BYTES  - default per-request limit (default: 102400 = 100 KiB)
 *   BODY_LIMIT_BULK_BYTES     - bulk ingest limit (default: 1048576 = 1 MiB)
 *   BODY_LIMIT_MAX_BYTES      - absolute parser ceiling (default: max of the above)
 *
 * Reverse proxies (nginx, Envoy, Cloudflare, ALB) usually enforce their own
 * body/client-max-body-size limits *before* the request reaches Node. Keep
 * proxy limits ≥ BODY_LIMIT_MAX_BYTES so clients see the API's structured
 * 413 rather than a generic proxy error. See docs/body-limits.md.
 */

export interface BodyLimitRouteRule {
  /** Path prefix matched against `req.path` (app-level) or full URL path. */
  pathPrefix: string;
  /** Maximum accepted body size in bytes for matching requests. */
  maxBytes: number;
}

export interface BodyLimitConfig {
  /** Default limit for endpoints without a more specific rule. */
  defaultMaxBytes: number;
  /** Absolute ceiling used by the JSON body parser. */
  maxBytes: number;
  /** Ordered list of path overrides; first match wins. */
  routes: BodyLimitRouteRule[];
}

/** 100 KiB — default for typical JSON API endpoints. */
export const BODY_LIMIT_DEFAULT_BYTES = 100 * 1024;

/** 1 MiB — bulk imports and similar high-volume ingest. */
export const BODY_LIMIT_BULK_BYTES = 1024 * 1024;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Load body-limit configuration from environment with safe defaults.
 */
export function loadBodyLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): BodyLimitConfig {
  const defaultMaxBytes = parsePositiveInt(
    env.BODY_LIMIT_DEFAULT_BYTES,
    BODY_LIMIT_DEFAULT_BYTES,
  );
  const bulkMaxBytes = parsePositiveInt(
    env.BODY_LIMIT_BULK_BYTES,
    BODY_LIMIT_BULK_BYTES,
  );
  const maxBytes = parsePositiveInt(
    env.BODY_LIMIT_MAX_BYTES,
    Math.max(defaultMaxBytes, bulkMaxBytes),
  );

  return {
    defaultMaxBytes,
    maxBytes,
    routes: [
      // Bulk credit-line ingest — higher ceiling than the default API surface.
      { pathPrefix: '/api/credit/lines/bulk', maxBytes: bulkMaxBytes },
    ],
  };
}

/**
 * Resolve the body limit that applies to a request path.
 * First matching route prefix wins (exact path or path + `/…`); otherwise default.
 */
export function resolveBodyLimit(
  path: string,
  config: BodyLimitConfig,
): number {
  const normalized = (path.split('?')[0] ?? path) || '/';
  for (const rule of config.routes) {
    const prefix = rule.pathPrefix.endsWith('/')
      ? rule.pathPrefix.slice(0, -1)
      : rule.pathPrefix;
    if (
      normalized === prefix ||
      normalized.startsWith(`${prefix}/`)
    ) {
      return rule.maxBytes;
    }
  }
  return config.defaultMaxBytes;
}

/**
 * Format a byte count for human-readable error messages (e.g. "100kb", "1mb").
 */
export function formatBodyLimitLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)}mb`;
  }
  if (bytes >= 1024 && bytes % 1024 === 0) {
    return `${bytes / 1024}kb`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}kb`;
  }
  return `${bytes}b`;
}

/**
 * Build the standard 413 client-facing message for a given limit.
 */
export function bodyTooLargeMessage(maxBytes: number): string {
  return `Payload Too Large. Request body exceeds the maximum size of ${formatBodyLimitLabel(maxBytes)} for this endpoint.`;
}
