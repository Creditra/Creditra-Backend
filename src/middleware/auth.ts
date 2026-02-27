import type { Request, Response, NextFunction } from 'express';

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
 *   - The received key value is NEVER included in logs or responses.
 *   - 401  → header is absent (caller is unaware of auth).
 *   - 403  → header present but the key is invalid.
 */
export function createApiKeyMiddleware(
    validKeysOrResolver: Set<string> | (() => Set<string>),
) {
    const resolve: () => Set<string> =
        typeof validKeysOrResolver === 'function'
            ? validKeysOrResolver
            : () => validKeysOrResolver;

    return function requireApiKey(
        req: Request,
        res: Response,
        next: NextFunction,
    ): void {
        const provided = req.headers['x-api-key'];

        if (!provided) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!resolve().has(provided as string)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        next();
    };
}
