import { Router } from 'express';
import { validationError } from '../errors/index.js';

export const riskRouter = Router();

riskRouter.post('/evaluate', (req, res, next) => {
  const { walletAddress } = req.body ?? {};
  if (!walletAddress) {
    return next(validationError('walletAddress is required', { field: 'walletAddress' }));
  }
  res.json({
    walletAddress,
    riskScore: 0,
    creditLimit: '0',
    interestRateBps: 0,
    message: 'Risk engine not yet connected; placeholder response.',
  });
});
