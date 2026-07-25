import type { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response.js';
import { ConflictError, isConflictError, sendConflict } from '../errors/index.js';

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
 * {@link ConflictError} is mapped to RFC 7807 `application/problem+json` with
 * a stable `code` (HTTP 409).
 *
 * In production, stack traces and internal error details are not leaked.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const maybeError = err as { status?: number; type?: string };

  // Body-parser emits this type when the payload exceeds the configured limit.
  if (maybeError.type === 'entity.too.large' || maybeError.status === 413) {
    fail(res, 'Request body too large. Maximum size is 100kb.', 413);
    return;
  }

  if (err instanceof ConflictError || isConflictError(err)) {
    sendConflict(res, err instanceof ConflictError ? err : new ConflictError({
      message: (err as ConflictError).message,
      code: (err as ConflictError).code,
      resource: (err as ConflictError).resource,
      details: (err as ConflictError).details,
    }));
    return;
  }

  if (err instanceof Error) {
    console.error('[errorHandler]', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });

    // Domain errors that predate ConflictError still map by name.
    if (err.name === 'ConflictError' || err.name === 'VersionConflictError' || err.name === 'InvalidTransitionError') {
      sendConflict(
        res,
        new ConflictError({
          message: err.message,
          code:
            err.name === 'VersionConflictError'
              ? 'version_conflict'
              : err.name === 'InvalidTransitionError'
                ? 'invalid_state_transition'
                : 'duplicate_resource',
        }),
      );
      return;
    }

    const status = maybeError.status ?? statusFromName(err.name);
    fail(res, status >= 500 ? 'Internal server error' : err.message, status);
    return;
  }

  console.error('[errorHandler]', err);
  fail(res, typeof err === 'string' ? err : 'Internal server error', 500);
}

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
    case 'ConflictError':
    case 'VersionConflictError':
    case 'InvalidTransitionError':
      return 409;
    default:
      return 500;
  }
}
