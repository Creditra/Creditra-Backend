/**
 * Global error handling middleware
 * Catches and logs errors with correlation IDs
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/**
 * Global error handler middleware
 * Must be registered after all routes
 */
export function errorHandlerMiddleware(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    logger.error('Request error', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
    }, err);

    // Don't expose internal error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';

    res.status(500).json({
        error: 'Internal server error',
        correlationId: req.correlationId,
        ...(isDevelopment && { message: err.message, stack: err.stack }),
    });
}
