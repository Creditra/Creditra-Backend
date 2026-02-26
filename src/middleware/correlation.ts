/**
 * Correlation ID middleware for request tracing
 * Generates or extracts correlation IDs from incoming requests
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Extend Express Request type to include correlationId
 */
declare global {
    namespace Express {
        interface Request {
            correlationId: string;
        }
    }
}

/**
 * Middleware to generate or extract correlation ID from request
 * Attaches correlation ID to request object and response header
 */
export function correlationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Extract from header or generate new UUID
    const correlationId =
        (req.headers[CORRELATION_ID_HEADER] as string) ??
        randomUUID();

    // Attach to request for downstream use
    req.correlationId = correlationId;

    // Add to response headers for client tracing
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
}
