import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureRawBody } from '../../middleware/rawBody.js';
import { signInboundWebhookPayload } from '../../middleware/inboundWebhookSignature.js';
import { defaultInboundWebhookNonceStore } from '../../services/inboundWebhookNonceStore.js';
import { inboundWebhookRouter } from '../inboundWebhooks.js';

const SECRET = 'route-secret';

function buildApp() {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.use('/api/inbound-webhooks', inboundWebhookRouter);
  return app;
}

function signedHeaders(body: string, nonce = 'route-nonce') {
  const timestamp = new Date().toISOString();
  return {
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signInboundWebhookPayload(SECRET, timestamp, nonce, Buffer.from(body)),
  };
}

describe('inbound webhook routes', () => {
  beforeEach(() => {
    process.env.INBOUND_WEBHOOK_SECRET = SECRET;
    defaultInboundWebhookNonceStore.resetForTests();
  });

  it('accepts signed inbound events', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/api/inbound-webhooks/events')
      .set(signedHeaders(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      data: { accepted: true, event: 'partner.updated' },
      error: null,
    });
  });

  it('rejects unsigned inbound events', async () => {
    const res = await request(buildApp())
      .post('/api/inbound-webhooks/events')
      .send({ event: 'partner.updated' });

    expect(res.status).toBe(401);
  });
});
