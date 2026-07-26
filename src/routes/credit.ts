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
  CreditLineNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
  TransactionType,
  suspendCreditLine,
  closeCreditLine,
  getCreditLine,
  getTransactions,
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

creditRouter.get(
  '/lines',
  validateQuery(creditLinesQuerySchema),
  // Response schema depends on pagination mode; cursor mode is unenveloped.
  async (req, res) => {
    const query = req.query as unknown as CreditLinesQuery;
    const limit = query.limit ?? 100;

    try {
      // Presence of `cursor` (including empty string) selects cursor pagination.
      if (query.cursor !== undefined) {
        const cursor =
          typeof query.cursor === 'string' && query.cursor.length > 0
            ? query.cursor
            : undefined;
        const result = await container.creditLineService.getAllCreditLinesWithCursor(
          cursor,
          limit,
        );

        const body = {
          creditLines: result.items,
          pagination: {
            limit,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
          },
        };

        // Optional response contract check (cursor mode is not enveloped).
        if (process.env.ENABLE_RESPONSE_VALIDATION === 'true') {
          const parsed = creditLinesCursorDataSchema.safeParse(body);
          if (!parsed.success) {
            return res.status(500).json({ data: null, error: 'Response contract violation' });
          }
        }

        return res.json(body);
      }

      const offset = query.offset ?? 0;
      const creditLines = await container.creditLineService.getAllCreditLines(offset, limit);
      const total = await container.creditLineService.getCreditLineCount();

      // Envelope success path — validate when enabled via middleware-equivalent check.
      const payload = {
        creditLines,
        pagination: { total, offset, limit },
      };

      if (process.env.ENABLE_RESPONSE_VALIDATION === 'true') {
        const parsed = envelopedCreditLinesListSchema.safeParse({ data: payload, error: null });
        if (!parsed.success) {
          return res.status(500).json({ data: null, error: 'Response contract violation' });
        }
      }

      return ok(res, payload);
    } catch (error) {
      return fail(res, error instanceof Error ? error : undefined, 400);
    }
  },
);

creditRouter.get(
  '/lines/:id',
  validateParams(idParamSchema),
  validateResponse(envelopedCreditLineSchema),
  async (req, res) => {
    try {
      const line = await container.creditLineService.getCreditLine(req.params.id);
      if (!line) {
        return fail(res, 'Credit line not found', 404);
      }
      return ok(res, line);
    } catch {
      return fail(res, 'Internal server error');
    }
  },
);

creditRouter.post(
  '/lines',
  validateBody(createCreditLineSchema),
  validateResponse(envelopedCreditLineSchema),
  async (req, res) => {
    try {
      const { walletAddress, creditLimit, requestedLimit, interestRateBps } = req.body ?? {};
      const finalLimit = creditLimit ?? requestedLimit;
      const creditLine = await container.creditLineService.createCreditLine({
        walletAddress,
        creditLimit: finalLimit,
        interestRateBps: interestRateBps ?? 0,
      });
      // Keep the dashboard read model correct on mutation (not just TTL-fresh).
      container.dashboardSummaryService.invalidate();
      return ok(res, creditLine, 201);
    } catch (error) {
      return fail(res, error instanceof Error ? error : undefined, 400);
    }
  },
);

creditRouter.put(
  '/lines/:id',
  validateParams(idParamSchema),
  validateBody(updateCreditLineSchema),
  validateResponse(envelopedCreditLineSchema),
  async (req, res) => {
    try {
      const body = req.body as UpdateCreditLineBody;
      const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
        creditLimit: body.creditLimit,
        interestRateBps: body.interestRateBps,
        status: body.status as never,
        expectedVersion: body.expectedVersion,
      });
      if (!creditLine) {
        return fail(res, 'Credit line not found', 404);
      }
      container.dashboardSummaryService.invalidate();
      return ok(res, creditLine);
    } catch (error) {
      // Optimistic-locking conflicts surface as 409; other validation as 400.
      if (error instanceof VersionConflictError) {
        return handleServiceError(error, res);
      }
      return fail(res, error instanceof Error ? error : undefined, 400);
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
    const { type, from, to, page, limit } = req.query as unknown as TransactionHistoryQuery;

    try {
      const result = getTransactions(
        id,
        {
          type: type as TransactionType | undefined,
          from: from as string | undefined,
          to: to as string | undefined,
        },
        { page: page ?? 1, limit: limit ?? 20 },
      );
      // ETag covers the filtered/paginated slice; new txs or filter changes
      // produce a different hash so clients cannot reuse a stale 304.
      okWithEtag(req, res, result);
    } catch (err) {
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
