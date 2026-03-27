const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export type CorsPolicy =
  | { kind: 'allowlist'; origins: Set<string> }
  | { kind: 'loopback' };

/**
 * Loads the browser-origin policy for the HTTP server.
 *
 * Production must define `CORS_ORIGINS` as a comma-separated allowlist of
 * exact browser origins. Non-production environments fall back to loopback
 * origins so local UI work stays ergonomic without extra env setup.
 */
export function loadCorsPolicy(): CorsPolicy {
  const raw = process.env.CORS_ORIGINS;

  if (raw !== undefined) {
    const origins = parseCorsOrigins(raw);

    if (origins.length === 0) {
      throw new Error(
        'CORS_ORIGINS is set but contains no valid browser origins. ' +
          'Use a comma-separated list of exact origins such as ' +
          'https://app.example.com,https://admin.example.com.',
      );
    }

    return { kind: 'allowlist', origins: new Set(origins) };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGINS must be set in production. ' +
        'Provide a comma-separated allowlist of exact browser origins before starting the service.',
    );
  }

  return { kind: 'loopback' };
}

/**
 * Returns true when the request origin should receive CORS headers.
 * Requests without an Origin header are allowed so server-to-server and CLI
 * traffic are not blocked by browser-only CORS rules.
 */
export function isAllowedCorsOrigin(origin: string | undefined, policy: CorsPolicy): boolean {
  if (!origin) {
    return true;
  }

  if (policy.kind === 'allowlist') {
    return policy.origins.has(origin);
  }

  return isLoopbackOrigin(origin);
}

function parseCorsOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeOrigin(origin));

  return [...new Set(origins)];
}

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid CORS origin '${origin}'. Only http and https origins are supported.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`Invalid CORS origin '${origin}'. Credentials are not allowed.`);
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(
      `Invalid CORS origin '${origin}'. Provide the exact origin only, without a path, query, or fragment.`,
    );
  }

  return parsed.origin;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');

    return LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}