import { Router } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';

export const riskRouter = Router();

// ---------------------------------------------------------------------------
// Public endpoints – no API key required
// ---------------------------------------------------------------------------

/**
 * POST /api/risk/evaluate
 * Evaluate risk for a given wallet address.
 */
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

// ---------------------------------------------------------------------------
// Internal / admin endpoints – require a valid API key
// ---------------------------------------------------------------------------

// Use a resolver so API_KEYS is read lazily per-request (handy for tests).
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());


/**
 * POST /api/risk/admin/recalibrate
 * Trigger a risk-model recalibration.  Requires admin API key.
 */
riskRouter.post('/admin/recalibrate', requireApiKey, (_req, res) => {
  res.json({ message: 'Risk model recalibration triggered' });
});
