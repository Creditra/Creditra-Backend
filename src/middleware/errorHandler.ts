import type { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response.js';
import {
  isPayloadTooLargeError,
  respondPayloadTooLarge,
  type RequestWithBodyLimit,
} from './bodyLimit.js';
import {
  BODY_LIMIT_DEFAULT_BYTES,
  bodyTooLargeMessage,
} from '../config/bodyLimit.js';
import { HTTP_PAYLOAD_TOO_LARGE } from '../utils/httpStatus.js';

/**
 * Standard error response interface for OpenAPI documentation
 */
export interface ErrorResponse {
  data: null;
  error: string;
}

/**
 * Global error-handling middleware.
 *
 * Catches any unhandled errors thrown (or passed via `next(err)`) from route
 * handlers and returns a consistent JSON error response using the fail() helper.
 *
 * In production, stack traces and internal error details are not leaked.
 * Oversized bodies (body-parser or {@link PayloadTooLargeError}) return an
 * explicit `413 Payload Too Large` problem+json + envelope response.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const maybeError = err as {
    status?: number;
    statusCode?: number;
    type?: string;
    limit?: number;
    length?: number;
  };

  // Body-parser and createJsonBodyLimitVerify emit entity.too.large / 413.
  // Prefer the path-resolved limit attached by body-limit middleware so a
  // parser-ceiling rejection still reports the endpoint's policy, not only
  // the absolute maxBytes used by express.json.
  if (isPayloadTooLargeError(err)) {
    const fromReq = (req as RequestWithBodyLimit).bodyLimitBytes;
    const fromErr =
      typeof maybeError.limit === 'number' && maybeError.limit > 0
        ? maybeError.limit
        : undefined;
    const limit = fromReq ?? fromErr ?? BODY_LIMIT_DEFAULT_BYTES;
    const length =
      typeof maybeError.length === 'number' ? maybeError.length : undefined;
    respondPayloadTooLarge(res, limit, length);
    return;
  }

  if (err instanceof Error) {
    console.error('[errorHandler]', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });

    const status = maybeError.status ?? maybeError.statusCode ?? statusFromName(err.name);
    fail(res, status >= 500 ? 'Internal server error' : err.message, status);
    return;
  }

  console.error('[errorHandler]', err);
  fail(res, typeof err === 'string' ? err : 'Internal server error', 500);
}

/** @deprecated Prefer respondPayloadTooLarge; kept for call-site clarity in docs. */
export function payloadTooLargeMessage(limitBytes = BODY_LIMIT_DEFAULT_BYTES): string {
  return bodyTooLargeMessage(limitBytes);
}

export { HTTP_PAYLOAD_TOO_LARGE };

function statusFromName(name: string): number {
  switch (name) {
    case 'ValidationError':
      return 400;
    case 'UnauthorizedError':
      return 401;
    case 'ForbiddenError':
      return 403;
    case 'NotFoundError':
      return 404;
    default:
      return 500;
  }
}
