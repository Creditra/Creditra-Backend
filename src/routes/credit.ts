import { Router } from 'express';
import { createLogger } from '../lib/logger.js';
import { createRequestLogger } from '../middleware/requestLogger.js';

export const creditRouter = Router();

const logger = createLogger('credit-router');
creditRouter.use(createRequestLogger(logger));

creditRouter.get('/lines', (_req, res) => {
  res.json({ creditLines: [] });
});

creditRouter.get('/lines/:id', (req, res) => {
  res.status(404).json({ error: 'Credit line not found', id: req.params.id });
});
