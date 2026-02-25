import { Router } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';
import { loadApiKeys } from '../config/apiKeys.js';

export const creditRouter = Router();

// ---------------------------------------------------------------------------
// Public endpoints – no API key required
// ---------------------------------------------------------------------------

creditRouter.get('/lines', (_req, res) => {
  res.json({ creditLines: [] });
});

creditRouter.get('/lines/:id', (req, res) => {
  res.status(404).json({ error: 'Credit line not found', id: req.params.id });
});

// ---------------------------------------------------------------------------
// Admin endpoints – require a valid API key via `X-API-Key` header
// ---------------------------------------------------------------------------

// Use a resolver function so API_KEYS is read lazily per-request,
// allowing the env var to be set after module import (e.g. in tests).
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());


/**
 * POST /api/credit/lines/:id/suspend
 * Suspend an active credit line.  Requires admin API key.
 */
creditRouter.post('/lines/:id/suspend', requireApiKey, (req, res) => {
  res.json({ message: 'Credit line suspended', id: req.params.id });
});

/**
 * POST /api/credit/lines/:id/close
 * Permanently close a credit line.  Requires admin API key.
 */
creditRouter.post('/lines/:id/close', requireApiKey, (req, res) => {
  res.json({ message: 'Credit line closed', id: req.params.id });
});
