import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../errors/index.js';

/**
 * Standard JSON error envelope returned by the API.
 */
export interface ErrorResponseBody {
    error: string;
    code: ErrorCode;
    details?: unknown;
}

/**
 * Global Express error-handling middleware.
 *
 * Place this **after** all route registrations in `app`.
 *
 * Behaviour:
 * - `AppError` instances are serialised directly using their status / code.
 * - Unrecognised errors are treated as 500 Internal Server Error.
 * - In non-production environments the `details` field includes the stack trace.
 * - `console.error` is used for server-side logging of 5xx errors.
 */
export function errorHandler(
    err: Error | AppError,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    // --- Determine status & code ----------------------------------------
    const isAppError = err instanceof AppError;

    const statusCode = isAppError ? err.statusCode : 500;
    const code = isAppError ? err.code : ErrorCode.INTERNAL_ERROR;
    const message = isAppError ? err.message : 'Internal server error';
    const details = isAppError ? err.details : undefined;

    // --- Server-side logging (only 5xx) ---------------------------------
    if (statusCode >= 500) {
        console.error(`[ERROR] ${code}: ${err.message}`, err.stack);
    }

    // --- Build response body --------------------------------------------
    const body: ErrorResponseBody = { error: message, code };

    if (details !== undefined) {
        body.details = details;
    }

    // In non-production, attach stack for debugging (never leak in prod)
    if (process.env.NODE_ENV !== 'production' && statusCode >= 500) {
        body.details = { ...(typeof details === 'object' && details ? details : {}), stack: err.stack };
    }

    res.status(statusCode).json(body);
}

/**
 * Catch-all for requests that don't match any registered route.
 * Must be placed **after** all route registrations but **before** errorHandler.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
    const err = new AppError(
        `Route ${req.method} ${req.path} not found`,
        ErrorCode.NOT_FOUND,
    );
    next(err);
}
