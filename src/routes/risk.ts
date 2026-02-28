import { Router, Request, Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import { riskEvaluateSchema } from '../schemas/index.js';
import type { RiskEvaluateBody } from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from '../utils/response.js';

export const riskRouter = Router();
const container = Container.getInstance();

// Middleware for admin routes
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

/**
 * POST /api/risk/evaluate
 * Evaluate risk for a given wallet address.
 */
riskRouter.post(
  '/evaluate',
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response) => {
    try {
      const { walletAddress, forceRefresh } = req.body as RiskEvaluateBody;

      if (!walletAddress) {
        return fail(res, 'walletAddress is required', 400);
      }

      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      return ok(res, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Risk evaluation failed';
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/risk/evaluations/:id
 */
riskRouter.get('/evaluations/:id', async (req: Request, res: Response) => {
  try {
    const evaluation = await container.riskEvaluationService.getRiskEvaluation(req.params.id);
    if (!evaluation) {
      return res.status(404).json({ error: 'Risk evaluation not found', id: req.params.id });
    }
    return res.json(evaluation);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch risk evaluation' });
  }
});

/**
 * GET /api/risk/wallet/:walletAddress/latest
 */
riskRouter.get('/wallet/:walletAddress/latest', async (req: Request, res: Response) => {
  try {
    const evaluation = await container.riskEvaluationService.getLatestRiskEvaluation(req.params.walletAddress);
    if (!evaluation) {
      return res.status(404).json({ error: 'No risk evaluation found for wallet' });
    }
    return res.json(evaluation);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch latest risk evaluation' });
  }
});

/**
 * GET /api/risk/wallet/:walletAddress/history
 */
riskRouter.get('/wallet/:walletAddress/history', async (req: Request, res: Response) => {
  try {
    const { offset, limit } = req.query;
    const offsetNum = offset ? parseInt(offset as string) : undefined;
    const limitNum = limit ? parseInt(limit as string) : undefined;

    const evaluations = await container.riskEvaluationService.getRiskEvaluationHistory(
      req.params.walletAddress,
      offsetNum,
      limitNum
    );

    return res.json({ evaluations });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch risk evaluation history' });
  }
});

/**
 * Admin: Trigger recalibration
 */
riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response) => {
  ok(res, { message: 'Risk model recalibration triggered' });
});

export default riskRouter;