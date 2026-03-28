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
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Log the full error for debugging (but don't include stack in response)
  console.error('[errorHandler]', {
    message: err.message,
    stack: err.stack,
    name: err.name,
  });

  // Use the fail() helper for consistent error responses
  // Determine appropriate status code based on error type
  let statusCode = 500;
  
  // You can extend this with custom error types that carry their own status codes
  if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
  }

  fail(res, err, statusCode);
}
