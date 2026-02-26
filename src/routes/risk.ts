import { Router, Request, Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { evaluateWallet } from "../services/riskService.js";
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();

// Use a resolver so API_KEYS is read lazily per-request (handy for tests).
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

// ---------------------------------------------------------------------------
// Public endpoints – no API key required
// ---------------------------------------------------------------------------

/**
 * POST /api/risk/evaluate
 * Evaluate risk for a given wallet address.
 */
riskRouter.post(
  "/evaluate",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.body as { walletAddress?: string };

    if (!walletAddress) {
      fail(res, "walletAddress is required", 400);
      return;
    }

    try {
      const result = await evaluateWallet(walletAddress);
      ok(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fail(res, message, 400);
    }
  },
);

// ---------------------------------------------------------------------------
// Internal / admin endpoints – require a valid API key
// ---------------------------------------------------------------------------

/**
 * POST /api/risk/admin/recalibrate
 * Trigger a risk-model recalibration.  Requires admin API key.
 */
riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  ok(res, { message: 'Risk model recalibration triggered' });
});
