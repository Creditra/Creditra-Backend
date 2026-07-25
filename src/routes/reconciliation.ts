/**
 * Reconciliation control-plane routes (admin-gated).
 *
 * Reconciliation is the safety net for any DB-vs-chain drift the indexer
 * might miss. See `docs/INDEXER.md` §6 for the full design.
 *
 * Surface (all require `X-API-Key`):
 * - POST `/trigger` — schedules a job on the in-process job queue and
 *   returns the job id immediately (`202 Accepted`).
 * - GET  `/status`  — exposes `{ workerRunning, queueSize, failedJobs }`
 *   so dashboards can alert on stuck queues or non-zero failure counts.
 *
 * Response bodies are validated when `ENABLE_RESPONSE_VALIDATION=true`.
 */
import { Router, type Request, type Response } from 'express';
import { Container } from '../container/Container.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { validateResponse } from '../middleware/validate.js';
import {
  envelopedReconciliationTriggerSchema,
  envelopedReconciliationStatusSchema,
} from '../schemas/index.js';

export const reconciliationRouter = Router();

const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

/**
 * POST /api/reconciliation/trigger
 * Manually trigger a reconciliation job (admin only)
 */
reconciliationRouter.post(
  '/trigger',
  requireApiKey,
  validateResponse(envelopedReconciliationTriggerSchema),
  (req: Request, res: Response) => {
    try {
      const jobId = container.reconciliationService.scheduleReconciliation();

      res.status(202).json({
        data: {
          jobId,
          message: 'Reconciliation job scheduled',
        },
        error: null,
      });
    } catch (error) {
      // Stable envelope; avoid leaking stack / SQL details.
      res.status(500).json({
        data: null,
        error: 'Failed to schedule reconciliation',
      });
      void error;
    }
  },
);

/**
 * GET /api/reconciliation/status
 * Get reconciliation worker status (admin only)
 */
reconciliationRouter.get(
  '/status',
  requireApiKey,
  validateResponse(envelopedReconciliationStatusSchema),
  (req: Request, res: Response) => {
    try {
      const isRunning = container.reconciliationWorker.isRunning();

      res.json({
        data: {
          workerRunning: isRunning,
          queueSize: container.reconciliationService['jobQueue'].size(),
          failedJobs: container.reconciliationService['jobQueue'].getFailedJobs().length,
        },
        error: null,
      });
    } catch (error) {
      res.status(500).json({
        data: null,
        error: 'Failed to get status',
      });
      void error;
    }
  },
);

export default reconciliationRouter;
