/**
 * src/middleware/requestLogger.ts
 *
 * Express middleware that:
 *  1. Assigns a unique `requestId` (UUID v4) to every incoming request.
 *  2. Logs a REQUEST entry with method, path, query, and redacted body.
 *  3. Intercepts res.json to capture the response body.
 *  4. On response finish, logs a RESPONSE entry with statusCode, durationMs,
 *     and (for non-2xx only) the redacted response body.
 *
 * Sensitive fields are always redacted via `redactObject` before logging.
 * Response bodies on successful (2xx) responses are intentionally omitted to
 * avoid leaking credit/risk data into log aggregation systems.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { type Logger, redactObject } from '../lib/logger.js';

// Augment Express Request so TypeScript knows about `req.id`.
declare module 'express-serve-static-core' {
    interface Request {
        id: string;
    }
}

/**
 * Returns an Express `RequestHandler` that performs structured
 * request/response logging using the provided `logger`.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
    return function requestLoggerMiddleware(
        req: Request,
        res: Response,
        next: NextFunction,
    ): void {
        // ── 1. Assign unique request ID ─────────────────────────────────────────
        req.id = randomUUID();
        const startMs = Date.now();

        // ── 2. Log REQUEST ───────────────────────────────────────────────────────
        logger.info('REQUEST', {
            requestId: req.id,
            method: req.method,
            path: req.path,
            query: req.query,
            body: redactObject(req.body),
        });

        // ── 3. Intercept res.json to capture response body ───────────────────────
        let capturedBody: unknown;
        const originalJson = res.json.bind(res);

        res.json = function (body: unknown): Response {
            capturedBody = body;
            return originalJson(body);
        };

        // ── 4. Log RESPONSE on finish ────────────────────────────────────────────
        res.on('finish', () => {
            const durationMs = Date.now() - startMs;
            const isError = res.statusCode < 200 || res.statusCode >= 300;

            const meta: Record<string, unknown> = {
                requestId: req.id,
                statusCode: res.statusCode,
                durationMs,
            };

            // Only include the body for non-2xx responses (errors) to prevent
            // successful credit/risk payloads from ending up in logs.
            if (isError && capturedBody !== undefined) {
                meta['responseBody'] = redactObject(capturedBody);
            }

            if (isError) {
                logger.warn('RESPONSE', meta);
            } else {
                logger.info('RESPONSE', meta);
            }
        });

        next();
    };
}
