import { Router, type Request, type Response } from 'express';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  transactionHistoryQuerySchema,
  walletAddressParamSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from '../utils/response.js';
import {
  CreditLineNotFoundError,
  TransactionType,
} from "../services/creditService.js";
import { loadRateLimitConfig } from "../config/rateLimit.js";
import {
  createRateLimitMiddleware,
  createIpKeyGenerator,
} from "../middleware/rateLimit.js";

export const creditRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

const VALID_TRANSACTION_TYPES = Object.values(TransactionType);

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}

creditRouter.get('/lines', async (req, res) => {
  try {
    const { offset, limit } = req.query;
    const offsetNum =
      typeof offset === 'string' ? Number.parseInt(offset, 10) : undefined;
    const limitNum =
      typeof limit === 'string' ? Number.parseInt(limit, 10) : undefined;

    const creditLines = await container.creditLineService.getAllCreditLines(
      offsetNum,
      limitNum,
    );

    const total = await container.creditLineService.getCreditLineCount();

    return ok(res, {
      creditLines,
      pagination: {
        total,
        offset: offsetNum || 0,
        limit: limitNum || 100
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch credit lines';
    return fail(res, message, 400);
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
    return fail(res, 'Internal server error', 500);
  }
});

creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req, res) => {
  try {
    const { walletAddress, creditLimit, requestedLimit, interestRateBps } = req.body;
    const finalLimit = creditLimit || requestedLimit;

    if (!walletAddress || !finalLimit) {
      return fail(res, 'Missing required fields: walletAddress and either creditLimit or requestedLimit', 400);
    }

    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit: finalLimit,
      interestRateBps: interestRateBps ?? 0,
    });

    return ok(res, creditLine, 201);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Bad request';
    return fail(res, message, 400);
  }
});

creditRouter.put('/lines/:id', async (req, res) => {
  try {
    const { creditLimit, interestRateBps, status } = req.body;

    const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
      creditLimit,
      interestRateBps,
      status
    });

    if (!creditLine) {
      return fail(res, 'Credit line not found', 404);
    }

    return ok(res, creditLine);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Bad request';
    return fail(res, message, 400);
  }
});

creditRouter.delete('/lines/:id', async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);

    if (!deleted) {
      return fail(res, 'Credit line not found', 404);
    }

    return res.status(204).send();
  } catch {
    return fail(res, 'Internal server error', 500);
  }
});

creditRouter.get(
  '/wallet/:walletAddress/lines',
  validateParams(walletAddressParamSchema),
  async (req, res) => {
  try {
    const creditLines = await container.creditLineService.getCreditLinesByWallet(
      req.params.walletAddress,
    );

    return ok(res, { creditLines });
  } catch {
    return fail(res, 'Internal server error', 500);
  }
});

creditRouter.get(
  '/lines/:id/transactions',
  validateQuery(transactionHistoryQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id;
    const { type, from, to, page: pageParam, limit: limitParam } = req.query;

    if (type !== undefined && !VALID_TRANSACTION_TYPES.includes(type as TransactionType)) {
      fail(
        res,
        `Invalid type filter. Must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}.`,
        400,
      );
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
      const { getTransactions: serviceGetTransactions } = await import('../services/creditService.js');
      const result = serviceGetTransactions(
        id,
        {
          type: type as TransactionType | undefined,
          from: from as string | undefined,
          to: to as string | undefined,
        },
        { page, limit },
      );

      ok(res, result);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/draw',
  validateBody(drawSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { borrowerId, amount } = req.body;
      const creditLine = await container.creditLineService.draw(req.params.id, borrowerId, amount);
      ok(res, { creditLine, amount });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to draw from credit line';
      const status = message === 'Unauthorized' ? 403 : 400;
      fail(res, message, status);
    }
  },
);

creditRouter.post(
  '/lines/:id/repay',
  validateBody(repaySchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, amount } = req.body;
      const creditLine = await container.creditLineService.repay(req.params.id, walletAddress, amount);
      ok(res, { creditLine, amount });
    } catch (err) {
      fail(res, err instanceof Error ? err.message : 'Failed to repay credit line', 400);
    }
  },
);

creditRouter.post(
  '/lines/:id/suspend',
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { suspendCreditLine: serviceSuspend } = await import('../services/creditService.js');
      const line = serviceSuspend(req.params.id);
      ok(res, { line, message: 'Credit line suspended.' });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  '/lines/:id/close',
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { closeCreditLine: serviceClose } = await import('../services/creditService.js');
      const line = serviceClose(req.params.id);
      ok(res, { line, message: 'Credit line closed.' });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

export default creditRouter;
