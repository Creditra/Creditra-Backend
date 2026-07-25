/**
 * Per-endpoint request body size limits.
 *
 * Two complementary guards:
 *
 * 1. {@link createBodyLimitMiddleware} / {@link createPathAwareBodyLimitMiddleware}
 *    — early `Content-Length` check so oversized requests are rejected before
 *    the body is buffered into memory.
 * 2. {@link createJsonBodyLimitVerify} — `express.json` `verify` callback that
 *    enforces the path-specific limit on the raw buffer (covers chunked
 *    transfer encoding where Content-Length is absent).
 *
 * Oversized bodies produce a typed error that {@link errorHandler} maps to a
 * structured `413 Payload Too Large` envelope response.
 *
 * See `docs/body-limits.md` for defaults and reverse-proxy guidance.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  bodyTooLargeMessage,
  formatBodyLimitLabel,
  resolveBodyLimit,
  type BodyLimitConfig,
} from '../config/bodyLimit.js';
import { fail } from '../utils/response.js';
import { HTTP_PAYLOAD_TOO_LARGE } from '../utils/httpStatus.js';

/** Augmented request fields used by body-limit middleware and errorHandler. */
export interface BodyLimitRequestFields {
  /** Resolved max body size (bytes) for this request. */
  bodyLimitBytes?: number;
  /** Human label for the limit (e.g. "100kb"). */
  bodyLimitLabel?: string;
  /** Raw body byte length observed by the JSON parser verify hook. */
  rawBodyLength?: number;
}

export type RequestWithBodyLimit = Request & BodyLimitRequestFields;

/**
 * Error thrown / passed to next() when a request body exceeds its limit.
 * Compatible with body-parser's `entity.too.large` shape so one errorHandler
 * branch covers both sources.
 */
export class PayloadTooLargeError extends Error {
  readonly status = HTTP_PAYLOAD_TOO_LARGE;
  readonly statusCode = HTTP_PAYLOAD_TOO_LARGE;
  readonly type = 'entity.too.large';
  readonly limit: number;
  readonly length?: number;
  readonly expose = true;

  constructor(limit: number, length?: number) {
    super(bodyTooLargeMessage(limit));
    this.name = 'PayloadTooLargeError';
    this.limit = limit;
    this.length = length;
  }
}

export function isPayloadTooLargeError(
  err: unknown,
): err is PayloadTooLargeError | { type: string; status?: number; limit?: number } {
  if (err instanceof PayloadTooLargeError) {
    return true;
  }
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const maybe = err as { type?: string; status?: number; statusCode?: number };
  return (
    maybe.type === 'entity.too.large' ||
    maybe.status === HTTP_PAYLOAD_TOO_LARGE ||
    maybe.statusCode === HTTP_PAYLOAD_TOO_LARGE
  );
}

function attachLimitMeta(req: RequestWithBodyLimit, maxBytes: number): void {
  req.bodyLimitBytes = maxBytes;
  req.bodyLimitLabel = formatBodyLimitLabel(maxBytes);
}

function contentLengthExceeds(req: Request, maxBytes: number): number | null {
  const raw = req.headers['content-length'];
  if (raw === undefined) {
    return null;
  }
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) {
    return null;
  }
  return length > maxBytes ? length : null;
}

/**
 * Fixed-limit middleware for a single route or router.
 *
 * @example
 * ```ts
 * router.post('/lines/bulk', createBodyLimitMiddleware(BODY_LIMIT_BULK_BYTES), handler);
 * ```
 */
export function createBodyLimitMiddleware(maxBytes: number): RequestHandler {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('createBodyLimitMiddleware: maxBytes must be a positive number');
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const r = req as RequestWithBodyLimit;
    attachLimitMeta(r, maxBytes);

    const oversize = contentLengthExceeds(req, maxBytes);
    if (oversize !== null) {
      respondPayloadTooLarge(res, maxBytes, oversize);
      return;
    }

    next();
  };
}

/**
 * Path-aware body limit middleware. Resolves the limit from {@link BodyLimitConfig}
 * using `req.path` (or `req.originalUrl` path) and rejects early on Content-Length.
 */
export function createPathAwareBodyLimitMiddleware(
  config: BodyLimitConfig,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = requestPath(req);
    const maxBytes = resolveBodyLimit(path, config);
    const r = req as RequestWithBodyLimit;
    attachLimitMeta(r, maxBytes);

    const oversize = contentLengthExceeds(req, maxBytes);
    if (oversize !== null) {
      respondPayloadTooLarge(res, maxBytes, oversize);
      return;
    }

    next();
  };
}

/**
 * `express.json({ verify })` hook: enforces the path-specific limit on the
 * raw buffer. Throws {@link PayloadTooLargeError} which errorHandler maps to 413.
 */
export function createJsonBodyLimitVerify(
  config: BodyLimitConfig,
): (req: Request, _res: Response, buf: Buffer) => void {
  return (req: Request, _res: Response, buf: Buffer): void => {
    const r = req as RequestWithBodyLimit;
    const path = requestPath(req);
    const maxBytes = r.bodyLimitBytes ?? resolveBodyLimit(path, config);
    attachLimitMeta(r, maxBytes);
    r.rawBodyLength = buf.length;

    if (buf.length > maxBytes) {
      throw new PayloadTooLargeError(maxBytes, buf.length);
    }
  };
}

/**
 * Write a 413 envelope response (also usable outside errorHandler for early rejects).
 */
export function respondPayloadTooLarge(
  res: Response,
  maxBytes: number,
  length?: number,
): void {
  if (res.headersSent) {
    return;
  }
  res.setHeader('X-Content-Length-Limit', String(maxBytes));
  if (length !== undefined) {
    res.setHeader('X-Content-Length-Received', String(length));
  }
  // RFC 7807-compatible problem details *and* the project envelope so existing
  // clients keep working while problem-aware clients can key off type/title.
  const label = formatBodyLimitLabel(maxBytes);
  const message = bodyTooLargeMessage(maxBytes);
  res.status(HTTP_PAYLOAD_TOO_LARGE).type('application/problem+json').json({
    type: 'https://httpstatuses.com/413',
    title: 'Payload Too Large',
    status: HTTP_PAYLOAD_TOO_LARGE,
    detail: message,
    limit: maxBytes,
    limitLabel: label,
    // Project envelope fields (docs/error-envelope.md)
    data: null,
    error: message,
  });
}

function requestPath(req: Request): string {
  // Prefer originalUrl path so mount points do not hide the full route.
  const raw = req.originalUrl || req.url || req.path || '';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

// Keep fail() available for callers that want the plain envelope only.
export function failPayloadTooLarge(res: Response, maxBytes: number): void {
  res.setHeader('X-Content-Length-Limit', String(maxBytes));
  fail(res, bodyTooLargeMessage(maxBytes), HTTP_PAYLOAD_TOO_LARGE);
}
