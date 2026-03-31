import type { Request, Response, NextFunction } from 'express';
import * as crypto from 'node:crypto';

/**
 * Factory that returns a `requireApiKey` Express middleware.
 *
 * Accepts either:
 *   - a fixed `Set<string>` of valid keys (useful for unit tests), OR
 *   - a resolver function `() => Set<string>` that is called on each request
 *     (useful in production so the middleware always reflects the latest
 *     `process.env.API_KEYS` value without needing a server restart).
 *
 * Security notes:
 *   - Timing-safe comparison using crypto.timingSafeEqual to prevent timing attacks.
 *   - The received key value is NEVER included in logs or responses.
 *   - 401  → header is absent (caller is unaware of auth).
 *   - 403  → header present but the key is invalid.
 */
export function createApiKeyMiddleware(
    validKeysOrResolver: Set<string> | (() => Set<string>),
) {
    const resolveKeys: () => string[] = 
        typeof validKeysOrResolver === 'function'
            ? () => Array.from(validKeysOrResolver())
            : () => Array.from(validKeysOrResolver);

    return function requireApiKey(
        req: Request,
        res: Response,
        next: NextFunction,
    ): void {
        const provided = (Array.isArray(req.headers['x-api-key']) ? req.headers['x-api-key'][0] : req.headers['x-api-key']) || '';

        if (!provided) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const keys = resolveKeys();
        const encoder = new TextEncoder();
        const providedBytes = encoder.encode(provided);

        for (const key of keys) {
            const keyBytes = encoder.encode(key);
            if (keyBytes.length === providedBytes.length && crypto.timingSafeEqual(keyBytes, providedBytes)) {
                next();
                return;
            }
        }

        res.status(403).json({ error: 'Forbidden' });
    };
}
