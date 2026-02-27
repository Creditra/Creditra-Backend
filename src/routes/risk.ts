import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { riskEvaluateSchema } from '../schemas/index.js';
import type { RiskEvaluateBody } from '../schemas/index.js';
import { Router, Request, Response } from "express";
import { evaluateWallet, InvalidWalletAddressError } from "../services/riskService.js";
import { isValidStellarPublicKey } from "../utils/stellarAddress.js";
import { Container } from '../container/Container.js';
import { Router, Request, Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { evaluateWallet } from "../services/riskService.js";
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();
const container = Container.getInstance();

riskRouter.post('/evaluate', validateBody(riskEvaluateSchema), (req, res) => {
  const { walletAddress } = req.body as RiskEvaluateBody;
  res.json({
    walletAddress,
    riskScore: 0,
    creditLimit: '0',
    interestRateBps: 0,
    message: 'Risk engine not yet connected; placeholder response.',
  });
});
router.post(
riskRouter.post('/evaluate', async (req, res) => {
  try {
    const { walletAddress, forceRefresh } = req.body ?? {};
    
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

    if (typeof walletAddress !== "string" || walletAddress.trim().length === 0) {
      fail(res, "walletAddress is required", 400);
      return;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress required' });
    }
    
    const result = await container.riskEvaluationService.evaluateRisk({
      walletAddress,
      forceRefresh
    });
    
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Risk evaluation failed';
    res.status(500).json({ error: message });
  }
});

riskRouter.get('/evaluations/:id', async (req, res) => {
  try {
    const evaluation = await container.riskEvaluationService.getRiskEvaluation(req.params.id);
    
    if (!evaluation) {
      return res.status(404).json({ error: 'Risk evaluation not found', id: req.params.id });
    }
    
    res.json(evaluation);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch risk evaluation' });
  }
});

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
riskRouter.get('/wallet/:walletAddress/latest', async (req, res) => {
  try {
    const evaluation = await container.riskEvaluationService.getLatestRiskEvaluation(req.params.walletAddress);
    
    if (!evaluation) {
      return res.status(404).json({ error: 'No risk evaluation found for wallet' });
    }
    
    res.json(evaluation);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch latest risk evaluation' });
  }
});

riskRouter.get('/wallet/:walletAddress/history', async (req, res) => {
  try {
    const { offset, limit } = req.query;
    const offsetNum = offset ? parseInt(offset as string) : undefined;
    const limitNum = limit ? parseInt(limit as string) : undefined;
    
    const evaluations = await container.riskEvaluationService.getRiskEvaluationHistory(
      req.params.walletAddress,
      offsetNum,
      limitNum
    );
    
    res.json({ evaluations });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch risk evaluation history' });
  }
  },
);

export default router;
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
