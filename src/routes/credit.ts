/**
 * Credit-line routes mounted at `/api/credit` by `src/index.ts`.
 *
 * Surface (see `docs/API.md` for full request/response shapes):
 * - GET    `/lines`                            — list (public)
 * - GET    `/lines/:id`                        — fetch (public)
 * - POST   `/lines`                            — create (validated body)
 * - PUT    `/lines/:id`                        — patch
 * - DELETE `/lines/:id`                        — delete
 * - GET    `/wallet/:walletAddress/lines`      — by wallet (validated path)
 * - GET    `/lines/:id/transactions`           — history with filters & paging
 * - POST   `/lines/:id/draw`                   — draw (validated body)
 * - POST   `/lines/:id/repay`                  — repay (validated body)
 * - POST   `/lines/:id/suspend`                — admin-auth state transition
 * - POST   `/lines/:id/close`                  — admin-auth state transition
 *
 * Domain errors are mapped to HTTP status by {@link handleServiceError}:
 * - {@link CreditLineNotFoundError} → 404
 * - {@link InvalidTransitionError}  → 409
 * - anything else                   → 500
 *
 * Successful responses use the shared envelope helpers `ok()` / `fail()`
 * from `src/utils/response.ts` so every body looks like `{ data, error }`.
 *
 * Request inputs are validated by Zod middleware (`validateBody|Query|Params`).
 * Response shapes are checked when `ENABLE_RESPONSE_VALIDATION=true`.
 */
import { Router, type Request, type Response } from 'express';
import {
  validateBody,
  validateParams,
  validateQuery,
  validateResponse,
} from '../middleware/validate.js';
import {
  createCreditLineSchema,
  creditLinesQuerySchema,
  updateCreditLineSchema,
  drawSchema,
  repaySchema,
  transactionHistoryQuerySchema,
  idParamSchema,
  walletAddressParamSchema,
  envelopedCreditLineSchema,
  envelopedCreditLinesListSchema,
  creditLinesCursorDataSchema,
  envelopedWalletCreditLinesSchema,
  envelopedTransactionHistorySchema,
  drawRepayResultSchema,
  type CreditLinesQuery,
  type DrawBody,
  type RepayBody,
  type TransactionHistoryQuery,
  type UpdateCreditLineBody,
} from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { defaultAdminAuditLog } from '../services/adminAuditLog.js';
import { adminActorFromRequest } from '../utils/adminActor.js';
import { ok, fail } from '../utils/response.js';
import { okWithEtag } from '../utils/etag.js';
import {
  ConflictError,
  internalError,
  notFound,
  sendProblem,
} from '../errors/index.js';
import {
  parseCursorQuery,
  toPaginationMeta,
  InvalidCursorError,
} from '../utils/cursorPagination.js';
import {
  CreditLineNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
  TransactionType,
  suspendCreditLine,
  closeCreditLine,
  getCreditLine,
  getTransactions,
  getTransactionsWithCursor,
  submitDrawRequest,
  submitRepayRequest,
} from '../services/creditService.js';
import { ConflictError, isConflictError, sendConflict } from '../errors/index.js';

export const creditRouter = Router();
const container = Container.getInstance();

/**
 * Maps a thrown service-layer error to an HTTP status + envelope.
 */
function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    sendProblem(
      res,
      notFound(err.message, 'credit_line'),
    );
    return;
  }
  if (err instanceof InvalidTransitionError) {
    sendProblem(
      res,
      new ConflictError({
        message: err.message,
        code: 'invalid_state_transition',
        resource: 'credit_line',
      }),
    );
    return;
  }
  if (err instanceof VersionConflictError) {
    sendProblem(
      res,
      new ConflictError({
        message: err.message,
        code: 'version_conflict',
        resource: 'credit_line',
      }),
    );
    return;
  }
  // Unknown failures: problem+json without leaking internals.
  if (err instanceof Error) {
    console.error('[credit.handleServiceError]', {
      message: err.message,
      name: err.name,
    });
  }
  sendProblem(res, internalError());
}

creditRouter.get('/lines', async (req, res) => {
  try {
    if ('cursor' in req.query) {
      const { cursor, limit } = parseCursorQuery(req.query as Record<string, unknown>, {
        defaultLimit: 100,
      });
      const result = await container.creditLineService.getAllCreditLinesWithCursor(cursor, limit);

      return res.json({
        creditLines: result.items,
        pagination: toPaginationMeta({
          limit,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        }),
      });
      // Keep the dashboard read model correct on mutation (not just TTL-fresh).
      container.dashboardSummaryService.invalidate();
      return ok(res, creditLine, 201);
    } catch (error) {
      return fail(res, error instanceof Error ? error : undefined, 400);
    }
  },
);

    const limit = parseIntegerQuery(req.query.limit, 100);
    const offset = parseIntegerQuery(req.query.offset, 0);
    const creditLines = await container.creditLineService.getAllCreditLines(offset, limit);
    const total = await container.creditLineService.getCreditLineCount();

    return ok(res, {
      creditLines,
      pagination: { total, offset, limit },
    });
  } catch (error) {
    return fail(res, error instanceof Error ? error : undefined, 400);
  }
});

creditRouter.get('/lines/:id', async (req, res) => {
  try {
    const line = await container.creditLineService.getCreditLine(req.params.id);
    if (!line) {
      return fail(res, 'Credit line not found', 404);
    }
  },
);

creditRouter.delete(
  '/lines/:id',
  validateParams(idParamSchema),
  async (req, res) => {
    try {
      const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
      if (!deleted) {
        return fail(res, 'Credit line not found', 404);
      }
      container.dashboardSummaryService.invalidate();
      return res.status(204).send();
    } catch {
      return fail(res, 'Internal server error');
    }
  },
);

creditRouter.get(
  '/wallet/:walletAddress/lines',
  validateParams(walletAddressParamSchema),
  validateResponse(envelopedWalletCreditLinesSchema),
  async (req, res) => {
    try {
      const lines = await container.creditLineService.getCreditLinesByWallet(
        req.params.walletAddress,
      );
      ok(res, { creditLines: lines });
    } catch {
      fail(res, 'Internal server error');
    }
  },
);

creditRouter.get(
  '/lines/:id/transactions',
  validateParams(idParamSchema),
  validateQuery(transactionHistoryQuerySchema),
  validateResponse(envelopedTransactionHistorySchema),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    const { type, from, to, page: pageParam, limit: limitParam } = req.query;

    if (type !== undefined && !VALID_TRANSACTION_TYPES.includes(type as TransactionType)) {
      fail(res, `Invalid type filter. Must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}.`, 400);
      return;
    }
    if (from !== undefined && isNaN(new Date(from as string).getTime())) {
      fail(res, "Invalid 'from' date. Must be a valid ISO 8601 date.", 400);
      return;
    }
    if (to !== undefined && isNaN(new Date(to as string).getTime())) {
      fail(res, "Invalid 'to' date. Must be a valid ISO 8601 date.", 400);
      return;
    }

    const filters = {
      type: type as TransactionType | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
    };

    try {
      // Cursor mode (standard) when `cursor` is present; page/limit remains for legacy clients.
      if ('cursor' in req.query) {
        const { cursor, limit } = parseCursorQuery(req.query as Record<string, unknown>, {
          defaultLimit: 20,
        });
        const result = getTransactionsWithCursor(id, filters, { cursor, limit });
        ok(res, {
          transactions: result.items,
          pagination: toPaginationMeta(result),
        });
        return;
      }

      const page = pageParam !== undefined ? parseInt(pageParam as string, 10) : 1;
      const limit = limitParam !== undefined ? parseInt(limitParam as string, 10) : 20;

      if (isNaN(page) || page < 1) {
        fail(res, "Invalid 'page'. Must be a positive integer.", 400);
        return;
      }
      if (isNaN(limit) || limit < 1 || limit > 100) {
        fail(res, "Invalid 'limit'. Must be between 1 and 100.", 400);
        return;
      }

      const result = getTransactions(id, filters, { page, limit });
      ok(res, result);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        fail(res, err.message, 400);
        return;
      }
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/suspend',
  adminAuth,
  validateParams(idParamSchema),
  (req: Request, res: Response): void => {
    try {
      const before = getCreditLine(req.params.id);
      const beforeSnapshot = before ? { ...before, events: [...before.events] } : undefined;
      const line = suspendCreditLine(req.params.id);
      defaultAdminAuditLog.record({
        actor: adminActorFromRequest(req),
        action: 'credit_line.suspended',
        target: { type: 'credit_line', id: req.params.id },
        before: beforeSnapshot,
        after: line,
      });
      res.status(200).json({ data: line, message: 'Credit line suspended.', error: null });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/close',
  adminAuth,
  validateParams(idParamSchema),
  (req: Request, res: Response): void => {
    try {
      const before = getCreditLine(req.params.id);
      const beforeSnapshot = before ? { ...before, events: [...before.events] } : undefined;
      const line = closeCreditLine(req.params.id);
      defaultAdminAuditLog.record({
        actor: adminActorFromRequest(req),
        action: 'credit_line.closed',
        target: { type: 'credit_line', id: req.params.id },
        before: beforeSnapshot,
        after: line,
      });
      res.status(200).json({ data: line, message: 'Credit line closed.', error: null });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/draw',
  validateParams(idParamSchema),
  validateBody(drawSchema),
  validateResponse(drawRepayResultSchema),
  async (req, res, next) => {
    try {
      const result = await submitDrawRequest(req.params.id, req.body as DrawBody);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

creditRouter.post(
  '/lines/:id/repay',
  validateParams(idParamSchema),
  validateBody(repaySchema),
  validateResponse(drawRepayResultSchema),
  async (req, res, next) => {
    try {
      const result = await submitRepayRequest(req.params.id, req.body as RepayBody);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default creditRouter;
