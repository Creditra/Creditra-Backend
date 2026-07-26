/**
 * API version and deprecation response headers.
 *
 * - Every `/api/v1/*` and legacy `/api/*` response gets `X-API-Version`.
 * - Legacy unversioned `/api/*` responses also get `Deprecation`, `Sunset`,
 *   and a `Link` successor-version pointing at the `/api/v1` equivalent.
 *
 * Spec references:
 * - `Deprecation` — RFC 9745
 * - `Sunset` — RFC 8594
 * - `Link` rel="successor-version" — RFC 5829
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  API_VERSION,
  loadApiVersionPolicy,
  resolveApiVersionPolicy,
  toVersionedApiPath,
  type ApiVersionPolicy,
} from '../config/apiVersion.js';

export const X_API_VERSION_HEADER = 'X-API-Version';
export const DEPRECATION_HEADER = 'Deprecation';
export const SUNSET_HEADER = 'Sunset';
export const LINK_HEADER = 'Link';

export interface ApiVersionMiddlewareOptions {
  /** Override sunset HTTP-date for legacy routes. */
  legacySunset?: string;
  /** Fixed version string (defaults to current major). */
  version?: string;
}

/**
 * Apply version / deprecation headers to a response from a resolved policy.
 */
export function applyApiVersionHeaders(
  res: Response,
  policy: ApiVersionPolicy,
  requestPath: string,
): void {
  res.setHeader(X_API_VERSION_HEADER, policy.version);

  if (!policy.deprecated) {
    return;
  }

  // RFC 9745 allows boolean `true` when the resource is already deprecated.
  res.setHeader(DEPRECATION_HEADER, 'true');

  if (policy.sunset) {
    res.setHeader(SUNSET_HEADER, policy.sunset);
  }

  const successor = toVersionedApiPath(requestPath.split('?')[0] ?? requestPath);
  const existingLink = res.getHeader(LINK_HEADER);
  const successorLink = `<${successor}>; rel="successor-version"`;
  if (typeof existingLink === 'string' && existingLink.length > 0) {
    res.setHeader(LINK_HEADER, `${existingLink}, ${successorLink}`);
  } else {
    res.setHeader(LINK_HEADER, successorLink);
  }
}

/**
 * Express middleware: stamp version (and deprecation) headers for API paths.
 * Non-API paths (`/health`, `/docs`, …) are left untouched.
 */
export function createApiVersionMiddleware(
  options: ApiVersionMiddlewareOptions = {},
): RequestHandler {
  const loaded = loadApiVersionPolicy();
  const legacySunset = options.legacySunset ?? loaded.legacySunset;
  const version = options.version ?? API_VERSION;

  return function apiVersionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Prefer originalUrl so mounts under routers still see the full path.
    const raw = req.originalUrl || req.url || req.path || '';
    const pathname = raw.split('?')[0] ?? raw;

    const policy = resolveApiVersionPolicy(pathname, { legacySunset });
    if (policy) {
      applyApiVersionHeaders(
        res,
        { ...policy, version: policy.version || version },
        pathname,
      );
    }

    next();
  };
}

/**
 * Middleware factory that always marks responses as the current non-deprecated
 * v1 surface (for use on the `/api/v1` router).
 */
export function createV1VersionMiddleware(
  options: { version?: string } = {},
): RequestHandler {
  const version = options.version ?? API_VERSION;
  return function v1VersionMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    res.setHeader(X_API_VERSION_HEADER, version);
    next();
  };
}

/**
 * Middleware factory that marks responses as deprecated legacy `/api/*`.
 * Expects to run on the legacy mount; uses `originalUrl` for successor Link.
 */
export function createLegacyDeprecationMiddleware(
  options: ApiVersionMiddlewareOptions = {},
): RequestHandler {
  const loaded = loadApiVersionPolicy();
  const legacySunset = options.legacySunset ?? loaded.legacySunset;
  const version = options.version ?? API_VERSION;

  return function legacyDeprecationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const raw = req.originalUrl || req.url || req.path || '';
    const pathname = raw.split('?')[0] ?? raw;

    applyApiVersionHeaders(
      res,
      {
        version,
        deprecated: true,
        sunset: legacySunset,
      },
      pathname,
    );
    next();
  };
}
