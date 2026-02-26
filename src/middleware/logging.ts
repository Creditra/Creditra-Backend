/**
 * Request logging middleware
 * Logs incoming requests and responses with correlation IDs
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/**
 * Middleware to log incoming HTTP requests
 */
export function requestLoggingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const startTime = Date.now();

    // Log incoming request
    logger.info('Incoming request', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        query: req.query,
        userAgent: req.headers['user-agent'],
    });

    // Capture response finish event
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const level = res.statusCode >= 400 ? 'warn' : 'info';

        const logMethod = level === 'warn' ? logger.warn.bind(logger) : logger.info.bind(logger);

        logMethod('Request completed', {
            correlationId: req.correlationId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: duration,
        });
    });

    next();
}
