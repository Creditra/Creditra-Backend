import { Router } from 'express';
import { createLogger } from '../lib/logger.js';
import { createRequestLogger } from '../middleware/requestLogger.js';

export const riskRouter = Router();

const logger = createLogger('risk-router');
riskRouter.use(createRequestLogger(logger));

riskRouter.post('/evaluate', (req, res) => {
  const { walletAddress } = req.body ?? {};
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress required' });
  }
  res.json({
    walletAddress,
    riskScore: 0,
    creditLimit: '0',
    interestRateBps: 0,
    message: 'Risk engine not yet connected; placeholder response.',
  });
});
