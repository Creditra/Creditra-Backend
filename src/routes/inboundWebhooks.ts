import { Router } from 'express';
import { createInboundWebhookSignatureMiddleware } from '../middleware/inboundWebhookSignature.js';
import { ok } from '../utils/response.js';

export const inboundWebhookRouter = Router();

inboundWebhookRouter.post(
  '/events',
  createInboundWebhookSignatureMiddleware(),
  (req, res) => {
    ok(res, {
      accepted: true,
      event: typeof req.body?.event === 'string' ? req.body.event : 'unknown',
    }, 202);
  },
);
