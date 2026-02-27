import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';

/**
 * Express middleware factory that validates `req.body` against a Zod schema.
 *
 * On success the parsed (and potentially transformed) body replaces `req.body`
 * so downstream handlers always receive well-typed data.
 *
 * On failure a `400` response is returned with structured error details:
 * ```json
 * {
 *   "error": "Validation failed",
 *   "details": [
 *     { "field": "walletAddress", "message": "Required" }
 *   ]
 * }
 * ```
 */
export function validateBody<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    // Replace body with the parsed & coerced value
    req.body = result.data;
    next();
  };
}
