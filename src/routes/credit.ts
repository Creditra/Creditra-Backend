import { Router, type Request, type Response } from 'express';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  transactionHistoryQuerySchema,
} from '../schemas/index.js';
import type { CreateCreditLineBody, DrawBody, RepayBody } from '../schemas/index.js';
import {
  createCreditLine,
  drawFromCreditLine,
  repayCredit,
} from '../services/creditService.js';
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
    const offsetNum = offset ? parseInt(offset as string) : undefined;
    const limitNum = limit ? parseInt(limit as string) : undefined;

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
    res.status(400).json({ error: message });
  }
});

creditRouter.get('/lines/:id', async (req, res) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(req.params.id);

    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }

    return res.json(creditLine);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch credit line' });
  }
});

creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req, res) => {
  try {
    const { walletAddress, requestedLimit } = req.body ?? {};

    if (!walletAddress || !requestedLimit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit: requestedLimit,
      interestRateBps: 0,
    });

    return res.status(201).json(creditLine);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create credit line';
    return res.status(400).json({ error: message });
  }
});

creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req, res, next) => {
  try {
    const result = await createCreditLine(req.body as CreateCreditLineBody);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

creditRouter.post('/lines/:id/draw', validateBody(drawSchema), async (req, res, next) => {
  try {
    const result = await drawFromCreditLine(req.params.id, req.body as DrawBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

creditRouter.post('/lines/:id/repay', validateBody(repaySchema), async (req, res, next) => {
  try {
    const result = await repayCredit(req.params.id, req.body as RepayBody);
    res.json(result);
  } catch (err) {
    next(err);
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

creditRouter.get("/lines/:id/transactions", validateQuery(transactionHistoryQuerySchema), async (req: Request, res: Response): Promise<void> => {
  const id = req.params["id"] as string;
  const { type, from, to, page: pageParam, limit: limitParam } = req.query;

  if (type !== undefined && !VALID_TRANSACTION_TYPES.includes(type as TransactionType)) {
    fail(
      res,
      `Invalid type filter. Must be one of: ${VALID_TRANSACTION_TYPES.join(", ")}.`,
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
    // Note: getTransactions is imported from creditService but uses a functional style.
    // In a real refactor we might move this to the container/service as well.
    const { getTransactions: serviceGetTransactions } = await import("../services/creditService.js");
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
});

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
