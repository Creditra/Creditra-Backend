import { Router } from 'express';
import { notFoundError } from '../errors/index.js';

export const creditRouter = Router();

creditRouter.get('/lines', (_req, res) => {
  res.json({ creditLines: [] });
});

creditRouter.get('/lines/:id', (req, _res, next) => {
  next(notFoundError('Credit line', req.params.id));
});
