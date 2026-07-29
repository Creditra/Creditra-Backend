/**
 * Bearer JWT authentication for internal service-to-service routes.
 *
 * Additive to (not a replacement for) `createApiKeyMiddleware` — see
 * `docs/security/service-auth.md` for the migration plan from shared API keys.
 */
import type { Request, Response, NextFunction } from 'express';
import { forbidden, sendProblem, unauthorized } from '../errors/index.js';
import { verifyServiceToken, type VerifiedServiceToken } from '../services/serviceTokens.js';

export type RequestWithServiceAccount = Request & { serviceAccount?: VerifiedServiceToken };

/**
 * Requires a valid `Authorization: Bearer <token>` service token.
 * When `requiredPermission` is given, the token's `permissions` claim must include it.
 */
export function requireServiceToken(requiredPermission?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      sendProblem(res, unauthorized('Unauthorized: Bearer service token required.'));
      return;
    }

    try {
      const claims = verifyServiceToken(header.slice('Bearer '.length));
      if (requiredPermission && !claims.permissions.includes(requiredPermission)) {
        sendProblem(res, forbidden('Forbidden: token lacks required permission.'));
        return;
      }
      (req as RequestWithServiceAccount).serviceAccount = claims;
      next();
    } catch {
      sendProblem(res, forbidden('Forbidden: invalid or expired service token.'));
    }
  };
}
