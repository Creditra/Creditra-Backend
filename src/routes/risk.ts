import { Router, Request, Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import { riskEvaluateSchema } from '../schemas/index.js';
import type { RiskEvaluateBody } from '../schemas/index.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { isValidStellarPublicKey } from '../utils/stellarAddress.js';
import { ok, fail } from '../utils/response.js';
import { Container } from '../container/Container.js';

export const riskRouter = Router();
const container = Container.getInstance();

// Lazily resolve API keys (useful for tests)
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

/**
 * ---------------------------------------------------------------------------
 * Public endpoints
 * ---------------------------------------------------------------------------
 */

/**
 * POST /api/risk/evaluate
 */
riskRouter.post(
  '/evaluate',
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, forceRefresh} = req.body as RiskEvaluateBody;

      const normalizedWalletAddress = walletAddress.trim();

      if (!isValidStellarPublicKey(normalizedWalletAddress)) {
        fail(res, 'Invalid wallet address format.', 400);
        return;
      }

      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress: normalizedWalletAddress,
        forceRefresh: forceRefresh ?? false,
      });

      ok(res, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Risk evaluation failed';
      fail(res, message, 500);
    }
  },
);

/**
 * GET /api/risk/evaluations/:id
 */
riskRouter.get(
  '/evaluations/:id',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const evaluation =
        await container.riskEvaluationService.getRiskEvaluation(
          req.params.id,
        );

      if (!evaluation) {
        fail(res, 'Risk evaluation not found', 404);
        return;
      }

      ok(res, evaluation);
    } catch {
      fail(res, 'Failed to fetch risk evaluation', 500);
    }
  },
);

/**
 * GET /api/risk/wallet/:walletAddress/latest
 */
riskRouter.get(
  '/wallet/:walletAddress/latest',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const evaluation =
        await container.riskEvaluationService.getLatestRiskEvaluation(
          req.params.walletAddress,
        );

      if (!evaluation) {
        fail(res, 'No risk evaluation found for wallet', 404);
        return;
      }

      ok(res, evaluation);
    } catch {
      fail(res, 'Failed to fetch latest risk evaluation', 500);
    }
  },
);

/**
 * GET /api/risk/wallet/:walletAddress/history
 */
riskRouter.get(
  '/wallet/:walletAddress/history',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const offset = req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : undefined;

      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : undefined;

      const evaluations =
        await container.riskEvaluationService.getRiskEvaluationHistory(
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

/**
 * ---------------------------------------------------------------------------
 * Admin endpoints (API key required)
 * ---------------------------------------------------------------------------
 */

/**
 * POST /api/risk/admin/recalibrate
 */
riskRouter.post(
  '/admin/recalibrate',
  requireApiKey,
  (_req: Request, res: Response): void => {
    ok(res, { message: 'Risk model recalibration triggered' });
  },
);

export default riskRouter;