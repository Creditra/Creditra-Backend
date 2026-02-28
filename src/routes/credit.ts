import { Router } from 'express';
import type { Request, Response } from 'express';
import { Container } from '../container/Container.js';
import { validateBody } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import type { CreateCreditLineBody, DrawBody, RepayBody } from '../schemas/index.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from "../utils/response.js";
import { paginateAndFilter } from '../utils/paginate.js';
import {
  CreditLineNotFoundError,
  getTransactions,
  suspendCreditLine,
  closeCreditLine,
  drawFromCreditLine,
  type TransactionType
} from "../services/creditService.js";

export const creditRouter = Router();
const container = Container.getInstance();

const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());
const VALID_TRANSACTION_TYPES: TransactionType[] = ["draw", "repayment", "status_change"];

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}

/** * GET /lines — Supports Pagination, Filtering, and Sorting */
creditRouter.get('/lines', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const allLines = await container.creditLineService.getAllCreditLines();
    const fieldMapping = {
      borrower: 'walletAddress' as keyof typeof allLines[0]
    };
    const result = paginateAndFilter(allLines, q as any, fieldMapping);
    
    return res.json({
        items: result.items,
        creditLines: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        pagination: {
            total: result.total,
            offset: (result.page - 1) * result.pageSize,
            limit: result.pageSize
        }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit lines' });
  }
});

/** GET /lines/:id */
creditRouter.get('/lines/:id', async (req: Request, res: Response) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(req.params.id);
    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found' });
    }
    res.json(creditLine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit line' });
  }
});

/** POST /lines */
creditRouter.post('/lines', validateBody(createCreditLineSchema), async (req: Request, res: Response) => {
  try {
    const { walletAddress, requestedLimit } = req.body as CreateCreditLineBody;
    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit: requestedLimit,
      interestRateBps: 0
    });
    res.status(201).json(creditLine);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Validation failed' });
  }
});

/** PUT /lines/:id */
creditRouter.put('/lines/:id', async (req: Request, res: Response) => {
  try {
    const { creditLimit, interestRateBps, status } = req.body;
    const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
      creditLimit, interestRateBps, status
    });
    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    res.json(creditLine);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update credit line' });
  }
});

/** DELETE /lines/:id */
creditRouter.delete('/lines/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete credit line' });
  }
});

/** POST /lines/:id/draw */
creditRouter.post('/lines/:id/draw', validateBody(drawSchema), async (req: Request, res: Response) => {
  try {
    const { amount, borrowerId } = req.body as DrawBody & { borrowerId?: string };
    const updated = drawFromCreditLine({
      id: req.params.id,
      borrowerId: borrowerId ?? "unknown",
      amount: parseFloat(amount),
    });
    res.status(200).json({ message: 'Draw successful', creditLine: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /lines/:id/transactions */
creditRouter.get("/lines/:id/transactions", (req: Request, res: Response): void => {
  const id = req.params["id"] as string;
  const { type, from, to, page: pageParam, limit: limitParam } = req.query;

  if (type !== undefined && !VALID_TRANSACTION_TYPES.includes(type as TransactionType)) {
    fail(res, `Invalid type filter. Must be one of: ${VALID_TRANSACTION_TYPES.join(", ")}.`, 400);
    return;
  }
  
  const page = pageParam !== undefined ? parseInt(pageParam as string, 10) : 1;
  const limit = limitParam !== undefined ? parseInt(limitParam as string, 10) : 20;

  try {
    const result = getTransactions(id, {
      type: type as TransactionType | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
    }, { page, limit });
    ok(res, result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

/** POST /lines/:id/suspend */
creditRouter.post("/lines/:id/suspend", requireApiKey, async (req: Request, res: Response): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, res);
    }
});

/** POST /lines/:id/close */
creditRouter.post("/lines/:id/close", requireApiKey, async (req: Request, res: Response): Promise<void> => {
    try {
      const line = closeCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, res);
    }
});

export default creditRouter;
