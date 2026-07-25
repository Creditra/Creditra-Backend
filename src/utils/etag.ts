/**
 * HTTP ETag helpers for conditional GET on read-heavy endpoints.
 *
 * Clients send the previously observed `ETag` via `If-None-Match`. When the
 * resource representation is unchanged the server returns `304 Not Modified`
 * with an empty body, saving bandwidth. When state changes the ETag changes
 * (it is a content hash of the JSON envelope) so clients re-download.
 *
 * Semantics (see `docs/etag-caching.md`):
 * - Strong ETags derived from SHA-256 of a stable JSON serialization.
 * - Weak-tag syntax (`W/"…"`) is accepted on inbound `If-None-Match` and
 *   compared via weak comparison (RFC 9110 §8.8.3.2).
 * - Responses set `Cache-Control: private, must-revalidate` so shared caches
 *   do not retain wallet-scoped data and clients revalidate before reuse.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { HTTP_NOT_MODIFIED, HTTP_OK } from './httpStatus.js';
import type { ApiResponse } from './response.js';

/** Cache directive for ETag-backed read responses. */
export const ETAG_CACHE_CONTROL = 'private, must-revalidate';

/**
 * Serialize a value to a deterministic JSON string suitable for hashing.
 * Dates become ISO-8601 strings (matching `JSON.stringify` / Express `res.json`).
 * Object key order is insertion order (stable for our domain objects).
 */
export function stableSerialize(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Compute a strong ETag for an arbitrary JSON-serializable value.
 * Format: `"<base64url-truncated-sha256>"` (quoted per RFC 9110 §8.8.3).
 */
export function computeEtag(value: unknown): string {
  const digest = createHash('sha256')
    .update(stableSerialize(value))
    .digest('base64url')
    .slice(0, 27);
  return `"${digest}"`;
}

/** Strip optional weak prefix and surrounding quotes for comparison. */
function normalizeTag(tag: string): string {
  let t = tag.trim();
  if (t.startsWith('W/') || t.startsWith('w/')) {
    t = t.slice(2).trim();
  }
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    t = t.slice(1, -1);
  }
  return t;
}

/**
 * Weak comparison of `If-None-Match` against a generated ETag.
 * Returns true when the client already has an equivalent representation.
 *
 * Supports:
 * - exact / weak-prefixed single tags
 * - comma-separated tag lists
 * - `*` (matches any current representation)
 */
export function etagMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  const header = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch;
  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === '*') {
    return true;
  }

  const target = normalizeTag(etag);
  return trimmed.split(',').some((part) => normalizeTag(part) === target);
}

/**
 * Apply ETag + Cache-Control headers. If `If-None-Match` matches, write a
 * 304 response (no body) and return `true`. Otherwise return `false` so the
 * caller can send the full payload.
 */
export function applyConditionalGet(
  req: Request,
  res: Response,
  etag: string,
): boolean {
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', ETAG_CACHE_CONTROL);

  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.status(HTTP_NOT_MODIFIED).end();
    return true;
  }
  return false;
}

/**
 * Success helper that attaches an ETag derived from the response envelope
 * and honours conditional requests with `304 Not Modified`.
 *
 * Equivalent to `ok()` when the client has no matching validator.
 */
export function okWithEtag<T>(
  req: Request,
  res: Response,
  data: T,
  statusCode: number = HTTP_OK,
): Response {
  const payload: ApiResponse<T> = {
    data,
    error: null,
  };
  const etag = computeEtag(payload);

  if (applyConditionalGet(req, res, etag)) {
    return res;
  }

  return res.status(statusCode).json(payload);
}
