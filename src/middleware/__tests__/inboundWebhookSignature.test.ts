import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { captureRawBody } from '../rawBody.js';
import {
  createInboundWebhookSignatureMiddleware,
  signInboundWebhookPayload,
} from '../inboundWebhookSignature.js';
import { InMemoryInboundWebhookNonceStore } from '../../services/inboundWebhookNonceStore.js';

const SECRET = 'inbound-webhook-secret';
const NOW = Date.parse('2026-07-09T00:00:00.000Z');

function buildApp(store = new InMemoryInboundWebhookNonceStore(() => NOW)) {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.post(
    '/webhook',
    createInboundWebhookSignatureMiddleware({
      secret: SECRET,
      nonceStore: store,
      now: () => NOW,
      toleranceMs: 5 * 60 * 1000,
    }),
    (_req, res) => res.status(202).json({ accepted: true }),
  );
  return app;
}

function signedHeaders(body: string, nonce = 'nonce-1', timestamp = '2026-07-09T00:00:00.000Z') {
  return {
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signInboundWebhookPayload(SECRET, timestamp, nonce, Buffer.from(body)),
  };
}

describe('createInboundWebhookSignatureMiddleware', () => {
  beforeEach(() => {
    delete process.env.INBOUND_WEBHOOK_SECRET;
  });

  it('accepts a valid signed webhook', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/webhook')
      .set(signedHeaders(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
  });

  it('rejects invalid signatures', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/webhook')
      .set({
        ...signedHeaders(body),
        'x-signature': `sha256=${'0'.repeat(64)}`,
      })
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid webhook signature');
  });

  it('rejects stale timestamps', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/webhook')
      .set(signedHeaders(body, 'nonce-1', '2026-07-08T23:00:00.000Z'))
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Stale webhook timestamp');
  });

  it('rejects replayed nonces', async () => {
    const store = new InMemoryInboundWebhookNonceStore(() => NOW);
    const app = buildApp(store);
    const body = JSON.stringify({ event: 'partner.updated' });
    const headers = signedHeaders(body);

    await request(app)
      .post('/webhook')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body)
      .expect(202);

    const replay = await request(app)
      .post('/webhook')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body);

    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('Replay detected');
  });

  it('returns 503 when the signing secret is not configured', async () => {
    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.post('/webhook', createInboundWebhookSignatureMiddleware(), (_req, res) => {
      res.status(202).json({ accepted: true });
    });

    const body = JSON.stringify({ event: 'partner.updated' });
    const res = await request(app)
      .post('/webhook')
      .set(signedHeaders(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(503);
  });
});
