/**
 * API versioning policy and path helpers.
 *
 * Canonical routes live under `/api/v1/*`. Unversioned `/api/*` routes remain
 * mounted for a defined transition window and advertise Deprecation + Sunset
 * headers so clients can migrate without a hard break.
 *
 * See `docs/api-versioning.md`.
 */

/** Current public API major version (exposed via `X-API-Version`). */
export const API_VERSION = '1' as const;

/** Path prefix for the current versioned surface. */
export const API_V1_PREFIX = '/api/v1' as const;

/** Legacy unversioned prefix kept for backward compatibility. */
export const API_LEGACY_PREFIX = '/api' as const;

/**
 * Default sunset for unversioned `/api/*` routes (RFC 8594 HTTP-date).
 * Override with `API_LEGACY_SUNSET` (HTTP-date string).
 */
export const DEFAULT_LEGACY_SUNSET = 'Thu, 31 Dec 2026 23:59:59 GMT';

export interface ApiVersionPolicy {
  /** Value of `X-API-Version` on every versioned/legacy API response. */
  version: string;
  /** Whether the matched mount is the deprecated unversioned surface. */
  deprecated: boolean;
  /** RFC 8594 Sunset HTTP-date when `deprecated` is true. */
  sunset: string | null;
}

export interface ApiVersionEnv {
  API_LEGACY_SUNSET?: string;
}

/**
 * Parse and validate an HTTP-date for Sunset, falling back to the default.
 */
export function resolveLegacySunset(raw?: string | null): string {
  const candidate = (raw ?? '').trim();
  if (!candidate) {
    return DEFAULT_LEGACY_SUNSET;
  }
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) {
    return DEFAULT_LEGACY_SUNSET;
  }
  // Normalise to a stable GMT HTTP-date.
  return new Date(ms).toUTCString();
}

/**
 * Load versioning policy knobs from the environment.
 */
export function loadApiVersionPolicy(env: ApiVersionEnv = process.env): {
  legacySunset: string;
} {
  return {
    legacySunset: resolveLegacySunset(env.API_LEGACY_SUNSET),
  };
}

/**
 * True when the request path is under the unversioned `/api/*` surface
 * (and not already `/api/v1/*`).
 */
export function isLegacyApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api')) {
    return false;
  }
  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
    return false;
  }
  // Only treat real API resource prefixes as legacy, not unrelated /api-foo.
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Map an unversioned `/api/...` path to its `/api/v1/...` successor.
 * Leaves already-versioned and non-API paths unchanged.
 */
export function toVersionedApiPath(pathname: string): string {
  const qIndex = pathname.indexOf('?');
  const pathOnly = qIndex === -1 ? pathname : pathname.slice(0, qIndex);
  const query = qIndex === -1 ? '' : pathname.slice(qIndex);

  if (pathOnly === '/api/v1' || pathOnly.startsWith('/api/v1/')) {
    return pathname;
  }
  if (pathOnly === '/api') {
    return `${API_V1_PREFIX}${query}`;
  }
  if (pathOnly.startsWith('/api/')) {
    return `${API_V1_PREFIX}/${pathOnly.slice('/api/'.length)}${query}`;
  }
  return pathname;
}

/**
 * Build the policy applied by middleware for a given request path.
 */
export function resolveApiVersionPolicy(
  pathname: string,
  options: { legacySunset?: string } = {},
): ApiVersionPolicy | null {
  const pathOnly = pathname.split('?')[0] ?? pathname;

  if (pathOnly === '/api/v1' || pathOnly.startsWith('/api/v1/')) {
    return {
      version: API_VERSION,
      deprecated: false,
      sunset: null,
    };
  }

  if (isLegacyApiPath(pathOnly)) {
    return {
      version: API_VERSION,
      deprecated: true,
      sunset: options.legacySunset ?? DEFAULT_LEGACY_SUNSET,
    };
  }

  return null;
}
