import type { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response.js';

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
 */
export function errorHandler(
  err: Error & { status?: number; type?: string },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Body-parser emits this type when the payload exceeds the configured limit.
  if (err.type === 'entity.too.large' || err.status === 413) {
    res
      .status(413)
      .json({ data: null, error: 'Request body too large. Maximum size is 100kb.' });
    return;
  }
  console.error('[errorHandler]', err);
  res.status(500).json({ error: 'Internal server error' });
}
