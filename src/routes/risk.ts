import { Router, type Request, type Response } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';
import { evaluateWallet, InvalidWalletAddressError } from '../services/riskService.js';
import { isValidStellarPublicKey } from '../utils/stellarAddress.js';

export const riskRouter = Router();

const requireApiKey = createApiKeyMiddleware(() => {
  try {
    return loadApiKeys();
  } catch {
    return new Set<string>();
  }
});

riskRouter.post('/evaluate', async (req: Request, res: Response): Promise<void> => {
  const { walletAddress } = req.body as { walletAddress?: string };

  if (typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
    res.status(400).json({ error: 'walletAddress is required' });
    return;
  }

  const normalizedWalletAddress = walletAddress.trim();
  if (!isValidStellarPublicKey(normalizedWalletAddress)) {
    res.status(400).json({ error: 'Invalid wallet address format.' });
    return;
  }

  try {
    const result = await evaluateWallet(normalizedWalletAddress);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidWalletAddressError) {
      res.status(400).json({ error: 'Invalid wallet address format.' });
      return;
    }
    res.status(500).json({ error: 'Unable to evaluate wallet at this time.' });
  }
});

riskRouter.post('/admin/recalibrate', requireApiKey, (_req: Request, res: Response): void => {
  res.status(200).json({ message: 'Risk model recalibration triggered' });
});

export default riskRouter;
