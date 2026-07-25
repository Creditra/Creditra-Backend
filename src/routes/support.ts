/**
 * Support tools routes — read-only borrower troubleshooting.
 *
 * Mounted at `/api/support`. All handlers require `X-Admin-Api-Key`
 * (admin/support operators only). No handler mutates state or schedules jobs.
 *
 * Surface:
 * - GET `/borrowers/:walletAddress`              — credit lines + recent txs + recon
 * - GET `/credit-lines/:id`                      — single credit-line snapshot + txs
 * - GET `/credit-lines/:id/transactions`         — recent transactions only
 * - GET `/reconciliation/status`                 — recon worker/queue (read-only)
 *
 * See `docs/API.md` § Support tools and issue #226.
 */
import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { validateParams, validateQuery } from '../middleware/validate.js';
import {
  supportBorrowerParamsSchema,
  supportCreditLineParamsSchema,
  supportRecentQuerySchema,
  type SupportRecentQuery,
} from '../schemas/support.schema.js';
import { Container } from '../container/Container.js';
import { SupportToolsService } from '../services/supportToolsService.js';
import { defaultJobQueue } from '../services/jobQueue.js';
import { ok, fail } from '../utils/response.js';

export const supportRouter = Router();

/** Every support route is admin-gated. Fail-closed when ADMIN_API_KEY unset. */
supportRouter.use(adminAuth);

function getSupportService(): SupportToolsService {
  const container = Container.getInstance();
  return new SupportToolsService({
    creditLineRepository: container.creditLineRepository,
    transactionRepository: container.transactionRepository,
    reconciliationWorker: container.reconciliationWorker,
    jobQueue: defaultJobQueue,
  });
}

/**
 * GET /api/support/borrowers/:walletAddress
 * Composite borrower lookup for incident response.
 */
supportRouter.get(
  '/borrowers/:walletAddress',
  validateParams(supportBorrowerParamsSchema),
  validateQuery(supportRecentQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      const { limit } = req.query as unknown as SupportRecentQuery;
      const result = await getSupportService().getBorrowerLookup(walletAddress, limit);
      return ok(res, result);
    } catch (error) {
      return fail(res, error instanceof Error ? error : 'Failed to load borrower support view', 500);
    }
  },
);

/**
 * GET /api/support/credit-lines/:id
 * Single credit-line troubleshooting snapshot.
 */
supportRouter.get(
  '/credit-lines/:id',
  validateParams(supportCreditLineParamsSchema),
  validateQuery(supportRecentQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { limit } = req.query as unknown as SupportRecentQuery;
      const result = await getSupportService().getCreditLineLookup(id, limit);
      if (!result) {
        return fail(res, 'Credit line not found', 404);
      }
      return ok(res, result);
    } catch (error) {
      return fail(res, error instanceof Error ? error : 'Failed to load credit line support view', 500);
    }
  },
);

/**
 * GET /api/support/credit-lines/:id/transactions
 * Recent transactions for a credit line (read-only).
 */
supportRouter.get(
  '/credit-lines/:id/transactions',
  validateParams(supportCreditLineParamsSchema),
  validateQuery(supportRecentQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { limit } = req.query as unknown as SupportRecentQuery;
      const txs = await getSupportService().getRecentTransactions(id, limit);
      if (txs === null) {
        return fail(res, 'Credit line not found', 404);
      }
      return ok(res, { transactions: txs });
    } catch (error) {
      return fail(res, error instanceof Error ? error : 'Failed to load transactions', 500);
    }
  },
);

/**
 * GET /api/support/reconciliation/status
 * Read-only reconciliation control-plane status (does not trigger jobs).
 */
supportRouter.get('/reconciliation/status', (_req: Request, res: Response) => {
  try {
    const status = getSupportService().getReconciliationStatus();
    return ok(res, status);
  } catch (error) {
    return fail(res, error instanceof Error ? error : 'Failed to load reconciliation status', 500);
  }
});

export default supportRouter;
