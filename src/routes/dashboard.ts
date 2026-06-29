/**
 * Dashboard read-model routes mounted at `/api/dashboard`.
 *
 * Serves aggregate summaries (credit-line totals, utilization, per-status
 * counts) from the cached {@link DashboardSummaryService} read model rather
 * than scanning the full credit-line set on every request.
 *
 * Staleness: responses may be up to the service TTL (default 30s) old. The
 * `generatedAt` field on the payload lets clients display data freshness.
 */
import { Router, type Request, type Response } from 'express';
import { Container } from '../container/Container.js';
import { ok, fail } from '../utils/response.js';

export const dashboardRouter = Router();

const container = Container.getInstance();

/**
 * GET /api/dashboard/summary
 * Returns the cached dashboard summary read model.
 */
dashboardRouter.get('/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await container.dashboardSummaryService.getSummary();
    ok(res, summary);
  } catch (error) {
    fail(res, error instanceof Error ? error : 'Failed to load dashboard summary', 500);
  }
});
