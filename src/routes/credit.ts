import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import type { CreateCreditLineBody, DrawBody, RepayBody } from '../schemas/index.js';
import { Router, Request, Response } from "express";
import { Container } from '../container/Container.js';
import { Router, Request, Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { ok, fail } from "../utils/response.js";
import {
  listCreditLines,
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
  drawFromCreditLine
} from "../services/creditService.js";

export const creditRouter = Router();
const container = Container.getInstance();

creditRouter.get('/lines', async (req, res) => {
  try {
    const { offset, limit } = req.query;
    const offsetNum = offset ? parseInt(offset as string) : undefined;
    const limitNum = limit ? parseInt(limit as string) : undefined;
    
    const creditLines = await container.creditLineService.getAllCreditLines(offsetNum, limitNum);
    const total = await container.creditLineService.getCreditLineCount();
    
    res.json({ 
      creditLines,
      pagination: {
        total,
        offset: offsetNum || 0,
        limit: limitNum || 100
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit lines' });
// Use a resolver function so API_KEYS is read lazily per-request,
// allowing the env var to be set after module import (e.g. in tests).
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
});

creditRouter.get('/lines/:id', async (req, res) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(req.params.id);
    
    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    
    res.json(creditLine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit line' });
  }
});

creditRouter.post('/lines', async (req, res) => {
  try {
    const { walletAddress, creditLimit, interestRateBps } = req.body;
    
    if (!walletAddress || !creditLimit || interestRateBps === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: walletAddress, creditLimit, interestRateBps' 
      });
    }
    
    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit,
      interestRateBps
    });
    
    res.status(201).json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create credit line';
    res.status(400).json({ error: message });
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
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    
    res.json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update credit line';
    res.status(400).json({ error: message });
  }
});

creditRouter.delete('/lines/:id', async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete credit line' });
  }
// ---------------------------------------------------------------------------
// Public endpoints – no API key required
// ---------------------------------------------------------------------------

creditRouter.get("/lines", (_req: Request, res: Response): void => {
  ok(res, listCreditLines());
});

creditRouter.get('/wallet/:walletAddress/lines', async (req, res) => {
  try {
    const creditLines = await container.creditLineService.getCreditLinesByWallet(req.params.walletAddress);
    res.json({ creditLines });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit lines for wallet' });
  }
});

creditRouter.post('/lines/:id/draw', (req, res) => {
  const { amount, borrowerId } = req.body;
  const id = req.params.id;

  try {
    const updated = drawFromCreditLine({
      id,
      borrowerId,
      amount,
    });

    res.status(200).json({
      message: 'Draw successful',
      creditLine: updated,
    });
  } catch (err: any) {
    switch (err.message) {
      case 'NOT_FOUND':
        return res.status(404).json({ error: 'Credit line not found' });
      case 'INVALID_STATUS':
        return res.status(400).json({ error: 'Credit line not active' });
      case 'UNAUTHORIZED':
        return res.status(403).json({ error: 'Unauthorized borrower' });
      case 'OVER_LIMIT':
        return res.status(400).json({ error: 'Amount exceeds credit limit' });
      case 'INVALID_AMOUNT':
        return res.status(400).json({ error: 'Invalid amount' });
      default:
        return res.status(500).json({ error: 'Internal server error' });
    }
  }
});
router.post(
/** Create a new credit line */
creditRouter.post('/lines', validateBody(createCreditLineSchema), (req, res) => {
  const { walletAddress, requestedLimit } = req.body as CreateCreditLineBody;
  res.status(201).json({
    id: 'placeholder-id',
    walletAddress,
    requestedLimit,
    status: 'pending',
    message: 'Credit line creation not yet implemented; placeholder response.',
  });
});

/** Draw from a credit line */
creditRouter.post('/lines/:id/draw', validateBody(drawSchema), (req, res) => {
  const { amount } = req.body as DrawBody;
  res.json({
    id: req.params.id,
    amount,
    message: 'Draw not yet implemented; placeholder response.',
  });
});

/** Repay a credit line */
creditRouter.post('/lines/:id/repay', validateBody(repaySchema), (req, res) => {
  const { amount } = req.body as RepayBody;
  res.json({
    id: req.params.id,
    amount,
    message: 'Repay not yet implemented; placeholder response.',
  });
});
router.post(
// ---------------------------------------------------------------------------
// Admin endpoints – require a valid API key via `X-API-Key` header
// ---------------------------------------------------------------------------

/**
 * POST /api/credit/lines/:id/suspend
 * Suspend an active credit line.  Requires admin API key.
 */
creditRouter.post(
  "/lines/:id/suspend",
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

/**
 * POST /api/credit/lines/:id/close
 * Permanently close a credit line.  Requires admin API key.
 */
creditRouter.post(
  "/lines/:id/close",
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = closeCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

export default router;
);
