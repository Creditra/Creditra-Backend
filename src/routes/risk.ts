import { Router, Request, Response } from "express";
import { validateBody } from '../middleware/validate.js';
import { riskEvaluateSchema } from '../schemas/index.js';
import type { RiskEvaluateBody } from '../schemas/index.js';
import { evaluateWallet, getRiskHistory, InvalidWalletAddressError } from "../services/riskService.js";
import { isValidStellarPublicKey } from "../utils/stellarAddress.js";
import { Container } from '../container/Container.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();
const container = Container.getInstance();

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
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.body as RiskEvaluateBody;

    if (typeof walletAddress !== "string" || walletAddress.trim().length === 0) {
      fail(res, "walletAddress is required", 400);
      return;
    }

    const normalizedWalletAddress = walletAddress.trim();
    if (!isValidStellarPublicKey(normalizedWalletAddress)) {
      fail(res, "Invalid wallet address format.", 400);
      return;
    }

    try {
      const result = await evaluateWallet(normalizedWalletAddress);
      ok(res, result);
    } catch (err) {
      if (err instanceof InvalidWalletAddressError) {
        fail(res, err.message, 400);
        return;
      }
      fail(res, "Unable to evaluate wallet at this time.", 500);
    }
  },
);

/**
 * GET /api/risk/history/:walletAddress
 * Get risk evaluation history for a wallet address.
 */
riskRouter.get(
  "/history/:walletAddress",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      fail(res, "walletAddress is required", 400);
      return;
    }

    try {
      const history = await getRiskHistory(walletAddress);
      ok(res, { walletAddress, evaluations: history });
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
 * Trigger a risk-model recalibration. Requires admin API key.
 */
riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  ok(res, { message: 'Risk model recalibration triggered' });
});
