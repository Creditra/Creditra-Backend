import { Router, type Request, type Response } from 'express';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
  transactionHistoryQuerySchema,
} from '../schemas/index.js';
import type { DrawBody, RepayBody } from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { ok, fail } from '../utils/response.js';
import {
  CreditLineNotFoundError,
  InvalidTransitionError,
  TransactionType,
  suspendCreditLine,
  closeCreditLine,
  getTransactions,
  submitDrawRequest,
  submitRepayRequest,
} from '../services/creditService.js';

export const creditRouter = Router();
const container = Container.getInstance();

const VALID_TRANSACTION_TYPES = Object.values(TransactionType);

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  if (err instanceof InvalidTransitionError) {
    fail(res, err.message, 409);
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}

creditRouter.get('/lines', async (req, res) => {
  try {
    const { offset, limit } = req.query;
    const offsetNum = typeof offset === 'string' ? Number.parseInt(offset, 10) : undefined;
    const limitNum = typeof limit === 'string' ? Number.parseInt(limit, 10) : undefined;

    const creditLines = await container.creditLineService.getAllCreditLines(offsetNum, limitNum);
    const total = await container.creditLineService.getCreditLineCount();

    return ok(res, {
      creditLines,
      pagination: { total, offset: offsetNum ?? 0, limit: limitNum ?? 100 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch credit lines';
    return res.status(400).json({ error: message });
  }
});

creditRouter.get('/lines/:id', async (req, res) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(req.params.id);
    if (!creditLine) {
      return fail(res, 'Credit line not found', 404);
    }
    return ok(res, creditLine);
  } catch {
    return fail(res, 'Failed to fetch credit line');
  }
});

creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req, res) => {
  try {
    const { walletAddress, requestedLimit } = req.body ?? {};
    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit: requestedLimit,
      interestRateBps: 0,
    });
    return res.status(201).json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create credit line';
    return res.status(400).json({ error: message });
  }
});

creditRouter.put('/lines/:id', async (req, res) => {
  try {
    const { creditLimit, interestRateBps, status } = req.body;
    const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
      creditLimit,
      interestRateBps,
      status,
    });
    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    return res.json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update credit line';
    return res.status(400).json({ error: message });
  }
});

creditRouter.delete('/lines/:id', async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    return res.status(204).send();
  } catch {
    return fail(res, 'Failed to delete credit line');
  }
});

creditRouter.get('/wallet/:walletAddress/lines', async (req, res) => {
  try {
    const lines = await container.creditLineService.getCreditLinesByWallet(
      req.params.walletAddress,
    );
    res.json({ creditLines: lines });
  } catch {
    res.status(500).json({ error: 'Failed to fetch credit lines for wallet' });
  }
});

creditRouter.get(
  '/lines/:id/transactions',
  validateQuery(transactionHistoryQuerySchema),
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

    try {
      const result = getTransactions(
        id,
        { type: type as TransactionType | undefined, from: from as string | undefined, to: to as string | undefined },
        { page, limit },
      );
      ok(res, result);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/suspend',
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params.id);
      ok(res, { data: line, message: 'Credit line suspended.' });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/close',
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = closeCreditLine(req.params.id);
      ok(res, { data: line, message: 'Credit line closed.' });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post('/lines/:id/draw', validateBody(drawSchema), async (req, res, next) => {
  try {
    const result = await submitDrawRequest(req.params.id, req.body as DrawBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

creditRouter.post('/lines/:id/repay', validateBody(repaySchema), async (req, res, next) => {
  try {
    const result = await submitRepayRequest(req.params.id, req.body as RepayBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default creditRouter;
