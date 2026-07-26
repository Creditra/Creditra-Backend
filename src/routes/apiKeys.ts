/**
 * API key lifecycle routes (admin-gated).
 *
 * Supports zero-downtime rotation: operators can issue additional keys while
 * old ones stay valid, then revoke old keys with a grace period. Only hashed
 * keys are stored; the plaintext is returned exactly once at creation.
 *
 * Surface (all require `X-Admin-Api-Key`):
 *  - POST   `/`            — issue a new key. Returns plaintext ONCE.
 *  - GET    `/`            — list key metadata (no secrets).
 *  - DELETE `/:id`         — revoke a key (enters grace period).
 *  - GET    `/audit`       — audit log of issue/revoke actions.
 *
 * Operational runbook: see `docs/API_KEY_ROTATION.md`.
 */
import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { defaultApiKeyStore } from '../services/apiKeyStore.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { issueApiKeySchema, idParamSchema } from '../schemas/index.js';
import type { IssueApiKeyBody } from '../schemas/index.js';

export const apiKeysRouter = Router();

/** POST /api/admin/api-keys — issue a new key (returns plaintext once). */
apiKeysRouter.post(
  '/',
  adminAuth,
  validateBody(issueApiKeySchema),
  (req: Request, res: Response) => {
    const body = req.body as IssueApiKeyBody;
    const label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'unlabelled';
    const { id, plaintext, metadata } = defaultApiKeyStore.issue(label);
    res.status(201).json({
      data: {
        id,
        // Surfaced exactly once — clients must store it now.
        key: plaintext,
        metadata,
      },
      error: null,
    });
  },
);

/** GET /api/admin/api-keys — list metadata (never secrets). */
apiKeysRouter.get('/', adminAuth, (_req: Request, res: Response) => {
  res.json({ data: defaultApiKeyStore.list(), error: null });
});

/** GET /api/admin/api-keys/audit — issue/revoke audit log. */
apiKeysRouter.get('/audit', adminAuth, (_req: Request, res: Response) => {
  res.json({ data: defaultApiKeyStore.auditLog(), error: null });
});

/** DELETE /api/admin/api-keys/:id — revoke (enters grace period). */
apiKeysRouter.delete(
  '/:id',
  adminAuth,
  validateParams(idParamSchema),
  (req: Request, res: Response) => {
    const ok = defaultApiKeyStore.revoke(req.params.id);
    if (!ok) {
      res.status(404).json({ data: null, error: 'API key not found' });
      return;
    }
    res.json({ data: { id: req.params.id, status: 'revoked' }, error: null });
  },
);
