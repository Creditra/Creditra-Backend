import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../schemas/index.js';
import type { CreateCreditLineBody, DrawBody, RepayBody } from '../schemas/index.js';
import {
  createCreditLine,
  drawFromCreditLine,
  repayCredit,
} from '../services/creditService.js';

export const creditRouter = Router();

creditRouter.get('/lines', (_req, res) => {
  res.json({ creditLines: [] });
});

creditRouter.get('/lines/:id', (req, res) => {
  res.status(404).json({ error: 'Credit line not found', id: req.params.id });
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
