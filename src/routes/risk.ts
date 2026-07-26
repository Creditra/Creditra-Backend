/**
 * Risk-evaluation routes mounted at `/api/risk` by `src/index.ts`.
 *
 * Surface (see `docs/API.md`, `docs/SIGNALS_INGEST.md`, `docs/ANOMALY_DETECTION.md`):
 * - POST `/evaluate`                          — body validated; returns
 *   the cached evaluation when fresh (<24h) unless `forceRefresh: true`.
 * - GET  `/evaluations/:id`                   — fetch by id (404 if missing).
 * - GET  `/wallet/:walletAddress/latest`      — most recent for wallet.
 * - GET  `/wallet/:walletAddress/history`     — paginated history.
 * - GET  `/admin/signals`                     — list anomaly risk signals (API key).
 * - GET  `/admin/signals/:id`                 — fetch one risk signal (API key).
 * - POST `/admin/recalibrate`                 — protected by `X-API-Key`.
 *
 * Wallet path params are validated by Zod (`walletAddressParamSchema`).
 * Response validation is opt-in via `ENABLE_RESPONSE_VALIDATION=true`.
 */
import { Router, type Request, type Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  validateResponse,
} from '../middleware/validate.js';
import { ok, fail } from '../utils/response.js';
import { Container } from '../container/Container.js';
import {
  riskEvaluateSchema,
  riskHistoryQuerySchema,
  riskSignalsQuerySchema,
  type RiskEvaluateBody,
  type RiskHistoryQuery,
  type RiskSignalsQuery,
} from '../schemas/index.js';
import { ConflictError, isConflictError, sendConflict } from '../errors/index.js';

export const riskRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

riskRouter.post(
  '/evaluate',
  validateBody(riskEvaluateSchema),
  validateResponse(envelopedRiskResultSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, forceRefresh } = req.body as RiskEvaluateBody;
      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      ok(res, result);
    } catch (error) {
      if (error instanceof ConflictError || isConflictError(error)) {
        sendConflict(res, error as ConflictError);
        return;
      }
      fail(res, error, 500);
    }
  },
);

/**
 * Explicit create path for risk evaluations. Conflicts (409) when an
 * unexpired evaluation already exists unless `forceRefresh` is true.
 */
riskRouter.post(
  '/evaluations',
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, forceRefresh } = req.body as RiskEvaluateBody;
      const result = await container.riskEvaluationService.createRiskEvaluation({
        walletAddress,
        forceRefresh,
      });
      ok(res, result, 201);
    } catch (error) {
      if (error instanceof ConflictError || isConflictError(error)) {
        sendConflict(res, error as ConflictError);
        return;
      }
      fail(res, error, 500);
    }
  },
);

riskRouter.get(
  '/evaluations/:id',
  validateParams(idParamSchema),
  validateResponse(envelopedRiskEvaluationSchema),
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

riskRouter.get(
  '/wallet/:walletAddress/latest',
  validateParams(walletAddressParamSchema),
  validateResponse(envelopedRiskEvaluationSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const evaluation = await container.riskEvaluationService.getLatestRiskEvaluation(
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

riskRouter.get(
  '/wallet/:walletAddress/history',
  validateParams(walletAddressParamSchema),
  validateQuery(riskHistoryQuerySchema),
  validateResponse(envelopedRiskHistorySchema),
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

/**
 * GET /api/risk/admin/signals
 * List anomaly risk signals for operator review (API-key auth).
 */
riskRouter.get(
  '/admin/signals',
  requireApiKey,
  validateQuery(riskSignalsQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query as unknown as RiskSignalsQuery;
      const result = await container.anomalyDetectionService.listSignals({
        walletAddress: query.walletAddress,
        creditLineId: query.creditLineId,
        signalType: query.signalType,
        status: query.status,
        correlationId: query.correlationId,
        offset: query.offset,
        limit: query.limit,
      });
      ok(res, result);
    } catch {
      fail(res, 'Failed to list risk signals', 500);
    }
  },
);

/**
 * GET /api/risk/admin/signals/:id
 * Fetch a single anomaly risk signal by id (API-key auth).
 */
riskRouter.get(
  '/admin/signals/:id',
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const signal = await container.anomalyDetectionService.getSignal(req.params.id);
      if (!signal) {
        fail(res, 'Risk signal not found', 404);
        return;
      }
      ok(res, signal);
    } catch {
      fail(res, 'Failed to fetch risk signal', 500);
    }
  },
);

riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  ok(res, { message: 'Risk model recalibration triggered' });
});

export default riskRouter;
