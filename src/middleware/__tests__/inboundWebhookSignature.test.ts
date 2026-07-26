import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { captureRawBody } from '../rawBody.js';
import {
  createInboundWebhookSignatureMiddleware,
  parseWebhookTimestamp,
  signInboundWebhookPayload,
  DEFAULT_INBOUND_WEBHOOK_TOLERANCE_MS,
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
      toleranceMs: DEFAULT_INBOUND_WEBHOOK_TOLERANCE_MS,
    }),
    (_req, res) => res.status(202).json({ accepted: true }),
  );
  return app;
}

function signedHeaders(
  body: string,
  nonce = 'nonce-1',
  timestamp = '2026-07-09T00:00:00.000Z',
) {
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

describe('parseWebhookTimestamp', () => {
  it('parses ISO-8601 timestamps', () => {
    expect(parseWebhookTimestamp('2026-07-09T00:00:00.000Z')).toBe(NOW);
  });

  it('parses unix epoch seconds', () => {
    expect(parseWebhookTimestamp(String(Math.floor(NOW / 1000)))).toBe(NOW);
  });

  it('returns null for garbage', () => {
    expect(parseWebhookTimestamp('not-a-date')).toBeNull();
    expect(parseWebhookTimestamp('')).toBeNull();
  });
});

describe('createInboundWebhookSignatureMiddleware', () => {
  beforeEach(() => {
    delete process.env.INBOUND_WEBHOOK_SECRET;
    delete process.env.INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS;
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

  it('accepts unix-epoch X-Timestamp values', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });
    const timestamp = String(Math.floor(NOW / 1000));

    const res = await request(buildApp())
      .post('/webhook')
      .set(signedHeaders(body, 'epoch-nonce', timestamp))
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(202);
  });

  it('rejects missing signature headers', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/webhook')
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing required webhook headers/i);
  });

  it('rejects malformed signatures', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/webhook')
      .set({
        ...signedHeaders(body),
        'x-signature': 'not-a-signature',
      })
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Malformed webhook signature');
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

  it('rejects future timestamps outside the tolerance window', async () => {
    const body = JSON.stringify({ event: 'partner.updated' });

    const res = await request(buildApp())
      .post('/webhook')
      .set(signedHeaders(body, 'future-nonce', '2026-07-09T01:00:00.000Z'))
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

  it('allows the same nonce after TTL expiry', async () => {
    let clock = NOW;
    const store = new InMemoryInboundWebhookNonceStore(() => clock);
    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.post(
      '/webhook',
      createInboundWebhookSignatureMiddleware({
        secret: SECRET,
        nonceStore: store,
        now: () => clock,
        toleranceMs: 1000,
      }),
      (_req, res) => res.status(202).json({ accepted: true }),
    );

    const body = JSON.stringify({ event: 'partner.updated' });
    const headers = signedHeaders(body, 'ttl-nonce', new Date(clock).toISOString());

    await request(app)
      .post('/webhook')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body)
      .expect(202);

    // Advance past nonce expiry (sentAt + tolerance).
    clock = NOW + 2000;
    const laterBody = JSON.stringify({ event: 'partner.updated' });
    const laterHeaders = signedHeaders(
      laterBody,
      'ttl-nonce',
      new Date(clock).toISOString(),
    );

    const res = await request(app)
      .post('/webhook')
      .set(laterHeaders)
      .set('content-type', 'application/json')
      .send(laterBody);

    expect(res.status).toBe(202);
  });

  it('does not claim a nonce when the signature is invalid', async () => {
    const store = new InMemoryInboundWebhookNonceStore(() => NOW);
    const app = buildApp(store);
    const body = JSON.stringify({ event: 'partner.updated' });
    const headers = {
      ...signedHeaders(body, 'poison-nonce'),
      'x-signature': `sha256=${'ab'.repeat(32)}`,
    };

    await request(app)
      .post('/webhook')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body)
      .expect(401);

    const valid = signedHeaders(body, 'poison-nonce');
    const res = await request(app)
      .post('/webhook')
      .set(valid)
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(202);
  });

  it('returns 503 when the signing secret is not configured', async () => {
    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.post(
      '/webhook',
      createInboundWebhookSignatureMiddleware(),
      (_req, res) => {
        res.status(202).json({ accepted: true });
      },
    );

    const body = JSON.stringify({ event: 'partner.updated' });
    const res = await request(app)
      .post('/webhook')
      .set(signedHeaders(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

describe('InMemoryInboundWebhookNonceStore', () => {
  it('purges expired nonces', () => {
    const store = new InMemoryInboundWebhookNonceStore(() => 1000);
    expect(store.claim('a', 1500)).toBe(true);
    expect(store.claim('a', 1500)).toBe(false);
    expect(store.purgeExpired(1600)).toBe(1);
    expect(store.claim('a', 2000)).toBe(true);
  });
});
