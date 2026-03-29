import { Router, type Request, type Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { ok, fail } from '../utils/response.js';
import { Container } from '../container/Container.js';
import {
  riskEvaluateSchema,
  riskHistoryQuerySchema,
  type RiskEvaluateBody,
  type RiskHistoryQuery,
} from '../schemas/index.js';

export const riskRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

riskRouter.post(
  '/evaluate',
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, forceRefresh } = req.body as RiskEvaluateBody;
      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      ok(res, result);
    } catch (error) {
      fail(res, error, 500);
    }
  },
);

riskRouter.get('/evaluations/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const evaluation = await container.riskEvaluationService.getRiskEvaluation(req.params.id);

    if (!evaluation) {
      fail(res, 'Risk evaluation not found', 404);
      return;
    }

    ok(res, evaluation);
  } catch {
    fail(res, 'Failed to fetch risk evaluation', 500);
  }
});

riskRouter.get('/wallet/:walletAddress/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const evaluation = await container.riskEvaluationService.getLatestRiskEvaluation(req.params.walletAddress);

    if (!evaluation) {
      fail(res, 'No risk evaluation found for wallet', 404);
      return;
    }

    ok(res, evaluation);
  } catch {
    fail(res, 'Failed to fetch latest risk evaluation', 500);
  }
});

riskRouter.get(
  '/wallet/:walletAddress/history',
  validateQuery(riskHistoryQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { offset, limit } = req.query as unknown as RiskHistoryQuery;
      const evaluations = await container.riskEvaluationService.getRiskEvaluationHistory(
        req.params.walletAddress,
        offset,
        limit,
      );

      ok(res, { evaluations });
    } catch {
      fail(res, 'Failed to fetch risk evaluation history', 500);
    }
  },
);

riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  ok(res, { message: 'Risk model recalibration triggered' });
});

export default riskRouter;
