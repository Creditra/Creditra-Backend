import { Router } from 'express';
import { ok, fail } from '../utils/response.js';

export const riskRouter = Router();

riskRouter.post('/evaluate', (req, res) => {
  const { walletAddress } = req.body ?? {};
  if (!walletAddress) {
    return fail(res, 'walletAddress required', 400);
  }

  ok(res, {
    walletAddress,
    riskScore: 0,
    creditLimit: '0',
    interestRateBps: 0,
    message: 'Risk engine not yet connected; placeholder response.',
  });
});
