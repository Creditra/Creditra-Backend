import { Router } from 'express';
import { creditLines } from '../data/creditLines.js';
import { paginateAndFilter } from '../utils/paginate.js';

export const creditRouter = Router();

creditRouter.get('/lines', (req, res) => {
  const result = paginateAndFilter(creditLines, req.query as Record<string, string>);
  res.json(result);
});

creditRouter.get('/lines/:id', (req, res) => {
  const line = creditLines.find((l) => l.id === req.params.id);
  if (!line) {
    return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
  }
  res.json(line);
});
