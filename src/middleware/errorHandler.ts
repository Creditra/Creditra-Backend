import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '../errors/index.js';
import { ApiResponse } from '../utils/response.js';

/**
 * Standard JSON error envelope returned by the API.
 */
export interface ErrorResponseBody extends ApiResponse<null> {
    code: ErrorCode;
    details?: unknown;
}

/**
 * Global Express error-handling middleware.
 *
 * Place this **after** all route registrations in `app`.
 */
export function errorHandler(
    err: Error | AppError,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    const isAppError = err instanceof AppError;

    const statusCode = isAppError ? err.statusCode : 500;
    const code = isAppError ? err.code : ErrorCode.INTERNAL_ERROR;
    const message = isAppError ? err.message : 'Internal server error';
    const details = isAppError ? err.details : undefined;

    if (statusCode >= 500) {
        console.error(`[ERROR] ${code}: ${err.message}`, err.stack);
    }

    // Standardised response envelope
    const body: ErrorResponseBody = {
        data: null,
        error: message,
        code
    };

    if (details !== undefined) {
        body.details = details;
    }

    if (process.env.NODE_ENV !== 'production' && statusCode >= 500) {
        body.details = { ...(typeof details === 'object' && details ? details : {}), stack: err.stack };
    }

    res.status(statusCode).json(body);
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
    const err = new AppError(
        `Route ${req.method} ${req.path} not found`,
        ErrorCode.NOT_FOUND,
    );
    next(err);
}
