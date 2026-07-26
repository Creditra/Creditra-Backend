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
    'x-signature': signInboundWebhookPayload(
      SECRET,
      timestamp,
      nonce,
      Buffer.from(body),
    ),
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
      .set('content-type', 'application/json')
      .send({ event: 'partner.updated' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing required webhook headers/i);
  });

  it('rejects replay of a previously accepted delivery', async () => {
    const body = JSON.stringify({ event: 'partner.payment' });
    const headers = signedHeaders(body, 'integration-replay-nonce');
    const app = buildApp();

    await request(app)
      .post('/api/inbound-webhooks/events')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body)
      .expect(202);

    const replay = await request(app)
      .post('/api/inbound-webhooks/events')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body);

    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('Replay detected');
  });

  it('rejects invalid signatures at the route boundary', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });
    const headers = {
      ...signedHeaders(body),
      'x-signature': `sha256=${'ff'.repeat(32)}`,
    };

    const res = await request(buildApp())
      .post('/api/inbound-webhooks/events')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid webhook signature');
  });
});
