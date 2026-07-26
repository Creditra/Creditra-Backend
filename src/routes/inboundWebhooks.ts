/**
 * Inbound partner webhook ingestion.
 *
 * Mounted at `/api/inbound-webhooks`. Every mutating route on this router
 * requires HMAC signature verification (see middleware + `docs/webhooks.md`).
 */
import { Router, type Request, type Response } from 'express';
import { createInboundWebhookSignatureMiddleware } from '../middleware/inboundWebhookSignature.js';
import { ok } from '../utils/response.js';

export const inboundWebhookRouter = Router();

/**
 * Accept a signed partner event.
 *
 * Headers: X-Timestamp, X-Nonce, X-Signature (see docs/webhooks.md).
 * Body: free-form JSON; partners should include an `event` string when possible.
 */
inboundWebhookRouter.post(
  '/events',
  createInboundWebhookSignatureMiddleware(),
  (req: Request, res: Response) => {
    const event =
      req.body && typeof req.body === 'object' && typeof req.body.event === 'string'
        ? req.body.event
        : 'unknown';

    ok(
      res,
      {
        accepted: true,
        event,
      },
      202,
    );
  },
);
