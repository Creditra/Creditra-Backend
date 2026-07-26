import type { Request, Response, NextFunction } from 'express';
import {
  AppError,
  internalError,
  sendProblem,
  translateUnknownError,
} from '../errors/index.js';

/**
 * Standard error response interface for OpenAPI documentation
 * @deprecated Prefer ProblemDetails from `src/errors` (RFC 7807).
 */
export interface ErrorResponse {
  data: null;
  error: string;
}

/**
 * Global error-handling middleware (central problem+json translator).
 *
 * Catches any unhandled errors thrown (or passed via `next(err)`) from route
 * handlers and returns RFC 7807 `application/problem+json` with a stable
 * taxonomy `type` and `code`.
 *
 * Legacy envelope fields `data` / `error` are included for older clients.
 * Stack traces and internal error details are never included in the body.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof Error) {
    console.error('[errorHandler]', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
  } else {
    console.error('[errorHandler]', err);
  }

  const translated = translateUnknownError(err);
  if (translated) {
    sendProblem(res, translated);
    return;
  }

  if (typeof err === 'string') {
    // Historical behaviour: explicit string errors may surface their text.
    sendProblem(
      res,
      new AppError({
        code: 'internal_error',
        message: err,
        exposeMessage: true,
      }),
    );
    return;
  }

  sendProblem(res, internalError());
}
