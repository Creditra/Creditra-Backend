import { Router, Request, Response, NextFunction } from 'express';
import { evaluateWallet } from '../services/riskService.js';
import { ok } from '../utils/response.js';
import { validationError } from '../errors/index.js';

export const riskRouter = Router();

riskRouter.post(
  '/evaluate',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { walletAddress } = req.body as { walletAddress?: string };

    if (!walletAddress) {
      return next(validationError('walletAddress is required', { field: 'walletAddress' }));
    }

    try {
      const result = await evaluateWallet(walletAddress);
      ok(res, result);
    } catch (err) {
      // Upstream treats evaluation failures as 400.
      const message = err instanceof Error ? err.message : 'Unknown evaluation error';
      next(validationError(message));
    }
  },
);
