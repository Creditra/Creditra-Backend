import { Router } from 'express';
import { ok, fail } from '../utils/response.js';

export const riskRouter = Router();

riskRouter.post('/evaluate', (req, res) => {
  const { walletAddress } = req.body ?? {};
  if (typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
    fail(res, 'walletAddress is required', 400);
    return;
  }
  ok(res, { walletAddress, message: 'Evaluation placeholder' });
});

export default riskRouter;
