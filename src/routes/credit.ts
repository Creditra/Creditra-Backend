import { Router } from 'express';
import { ok, fail } from '../utils/response.js';

export const creditRouter = Router();

creditRouter.get('/lines', (_req, res) => {
  ok(res, { creditLines: [] });
});

creditRouter.get('/lines/:id', (req, res) => {
  fail(res, `Credit line not found: ${req.params.id}`, 404);
});
