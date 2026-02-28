import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateBody } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import type { CreateCreditLineBody, DrawBody, RepayBody } from '../schemas/index.js';
import { Container } from '../container/Container.js';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from "../utils/response.js";
// removed static creditLines import
import { paginateAndFilter } from '../utils/paginate.js';
import {
  CreditLineNotFoundError,
  getTransactions,
  suspendCreditLine,
  closeCreditLine,
  drawFromCreditLine
} from "../services/creditService.js";

export const creditRouter = Router();
const container = Container.getInstance();
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}

/** * GET /lines — Supports Pagination, Filtering, and Sorting
 * Satisfies Requirement for Issue #22
 */
creditRouter.get('/lines', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    
    // Fetch all lines from container
    const allLines = await container.creditLineService.getAllCreditLines();
    
    // Map borrower filter sorting to walletAddress on the CreditLine model
    const fieldMapping = {
      borrower: 'walletAddress' as keyof typeof allLines[0]
    };

    const result = paginateAndFilter(allLines, q as any, fieldMapping);
    
    return res.json({
        items: result.items,
        creditLines: result.items, // backwards compatibility
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

export default creditRouter;