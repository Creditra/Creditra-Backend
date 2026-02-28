import { Router, Request, Response } from 'express';
import { Container } from '../container/Container.js';
import { validateBody } from '../middleware/validate.js';
import { riskEvaluateSchema } from '../schemas/index.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from "../utils/response.js";
import { isValidStellarPublicKey } from "../utils/stellarAddress.js";

export const riskRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

riskRouter.post('/evaluate', validateBody(riskEvaluateSchema), async (req, res) => {
  try {
    const { walletAddress, forceRefresh } = req.body ?? {};
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
      req.params.walletAddress, offsetNum, limitNum
    );
    res.json({ evaluations });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch risk evaluation history' });
  }
});

riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  ok(res, { message: 'Risk model recalibration triggered' });
});

export default riskRouter;
