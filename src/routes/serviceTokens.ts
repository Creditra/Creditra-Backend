/**
 * Service-token lifecycle routes (admin-gated via `X-Admin-Api-Key`).
 *
 * Mints short-lived signed JWTs for internal service-to-service calls, and
 * rotates the active signing key. See `docs/security/service-auth.md`.
 *
 * Surface:
 *  - POST `/`       — mint a token for a named service account.
 *  - POST `/rotate` — rotate the signing key (old tokens stay valid until they age out).
 */
import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { validateBody } from '../middleware/validate.js';
import { mintServiceTokenSchema, type MintServiceTokenBody } from '../schemas/serviceToken.schema.js';
import { mintServiceToken, rotateServiceTokenKey } from '../services/serviceTokens.js';
import { ok } from '../utils/response.js';

export const serviceTokensRouter = Router();

serviceTokensRouter.post(
  '/',
  adminAuth,
  validateBody(mintServiceTokenSchema),
  (req: Request, res: Response): void => {
    const { serviceAccount, permissions, ttlSeconds } = req.body as MintServiceTokenBody;
    const { token, expiresAt } = mintServiceToken({ sub: serviceAccount, permissions }, ttlSeconds);
    ok(res, { token, expiresAt });
  },
);

serviceTokensRouter.post('/rotate', adminAuth, (_req: Request, res: Response): void => {
  const { kid } = rotateServiceTokenKey();
  ok(res, { kid });
});

export default serviceTokensRouter;
