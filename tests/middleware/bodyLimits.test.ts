import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { app } from '../../src/index.js';
import {
  BODY_LIMIT_BULK_BYTES,
  BODY_LIMIT_DEFAULT_BYTES,
  bodyTooLargeMessage,
  formatBodyLimitLabel,
  loadBodyLimitConfig,
  resolveBodyLimit,
} from '../../src/config/bodyLimit.js';
import {
  createBodyLimitMiddleware,
  createJsonBodyLimitVerify,
  createPathAwareBodyLimitMiddleware,
  PayloadTooLargeError,
  respondPayloadTooLarge,
} from '../../src/middleware/bodyLimit.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

function buildSizedJson(approxBytes: number): string {
  // Produce a JSON object whose serialized size is slightly above/around target.
  const overhead = '{"walletAddress":""}'.length;
  const pad = Math.max(0, approxBytes - overhead);
  return JSON.stringify({ walletAddress: 'x'.repeat(pad) });
}

describe('JSON body size limit (default endpoints)', () => {
  it('accepts a payload within the default 100kb limit', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send({ walletAddress: '0x123' });

    expect(res.status).not.toBe(413);
  });

  it('returns 413 problem+json for a payload exceeding 100kb', async () => {
    const largeBody = buildSizedJson(110 * 1024);

    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .set('Content-Length', String(Buffer.byteLength(largeBody)))
      .send(largeBody);

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['x-content-length-limit']).toBe(String(BODY_LIMIT_DEFAULT_BYTES));
    expect(res.body).toMatchObject({
      type: 'https://httpstatuses.com/413',
      title: 'Payload Too Large',
      status: 413,
      data: null,
      error: expect.stringMatching(/Payload Too Large/i),
      limit: BODY_LIMIT_DEFAULT_BYTES,
      limitLabel: '100kb',
    });
    expect(res.body.detail).toContain('100kb');
    expect(res.body.error).toContain('100kb');
  });

});

describe('per-endpoint body limits', () => {
  function buildAppWithLimits() {
    const config = loadBodyLimitConfig();
    const testApp = express();
    testApp.use(createPathAwareBodyLimitMiddleware(config));
    testApp.use(
      express.json({
        limit: config.maxBytes,
        verify: createJsonBodyLimitVerify(config),
      }),
    );

    testApp.post('/api/risk/evaluate', (_req, res) => {
      res.status(200).json({ data: { ok: true }, error: null });
    });
    testApp.post('/api/credit/lines/bulk', (_req, res) => {
      res.status(200).json({ data: { ok: true }, error: null });
    });
    // Route-level fixed middleware example (webhook-style)
    testApp.post(
      '/api/custom/small',
      createBodyLimitMiddleware(1024),
      express.json({ limit: 1024 }),
      (_req, res) => {
        res.status(200).json({ data: { ok: true }, error: null });
      },
    );
    testApp.use(errorHandler);
    return testApp;
  }

  it('allows ~200kb on the bulk path (higher limit) but not on default paths', async () => {
    const testApp = buildAppWithLimits();
    const midBody = buildSizedJson(200 * 1024);

    const defaultRes = await request(testApp)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send(midBody);

    expect(defaultRes.status).toBe(413);
    expect(defaultRes.body.limit).toBe(BODY_LIMIT_DEFAULT_BYTES);

    const bulkRes = await request(testApp)
      .post('/api/credit/lines/bulk')
      .set('Content-Type', 'application/json')
      .send(midBody);

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body).toMatchObject({ data: { ok: true } });
  });

  it('returns 413 on bulk when payload exceeds the bulk ceiling', async () => {
    const testApp = buildAppWithLimits();
    const huge = buildSizedJson(BODY_LIMIT_BULK_BYTES + 50 * 1024);

    const res = await request(testApp)
      .post('/api/credit/lines/bulk')
      .set('Content-Type', 'application/json')
      .send(huge);

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      title: 'Payload Too Large',
      status: 413,
      limit: BODY_LIMIT_BULK_BYTES,
      limitLabel: '1mb',
      data: null,
    });
    expect(res.body.error).toMatch(/1mb/i);
  });

  it('supports fixed createBodyLimitMiddleware on a single route', async () => {
    const testApp = buildAppWithLimits();
    const over1k = buildSizedJson(2048);

    const res = await request(testApp)
      .post('/api/custom/small')
      .set('Content-Type', 'application/json')
      .send(over1k);

    expect(res.status).toBe(413);
    expect(res.body.limit).toBe(1024);
  });
});

describe('body limit config helpers', () => {
  it('loads defaults', () => {
    const config = loadBodyLimitConfig({});
    expect(config.defaultMaxBytes).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(config.maxBytes).toBeGreaterThanOrEqual(BODY_LIMIT_BULK_BYTES);
    expect(config.routes.some((r) => r.pathPrefix.includes('bulk'))).toBe(true);
  });

  it('respects env overrides', () => {
    const config = loadBodyLimitConfig({
      BODY_LIMIT_DEFAULT_BYTES: '2048',
      BODY_LIMIT_BULK_BYTES: '4096',
      BODY_LIMIT_MAX_BYTES: '8192',
    });
    expect(config.defaultMaxBytes).toBe(2048);
    expect(config.routes[0]?.maxBytes).toBe(4096);
    expect(config.maxBytes).toBe(8192);
  });

  it('resolves path prefixes', () => {
    const config = loadBodyLimitConfig({});
    expect(resolveBodyLimit('/api/risk/evaluate', config)).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(resolveBodyLimit('/api/credit/lines/bulk', config)).toBe(BODY_LIMIT_BULK_BYTES);
    expect(resolveBodyLimit('/api/credit/lines/bulk/extra', config)).toBe(BODY_LIMIT_BULK_BYTES);
    expect(resolveBodyLimit('/api/credit/lines/bulkish', config)).toBe(BODY_LIMIT_DEFAULT_BYTES);
  });

  it('formats labels and messages', () => {
    expect(formatBodyLimitLabel(100 * 1024)).toBe('100kb');
    expect(formatBodyLimitLabel(1024 * 1024)).toBe('1mb');
    expect(bodyTooLargeMessage(100 * 1024)).toMatch(/100kb/);
  });
});

describe('PayloadTooLargeError and respondPayloadTooLarge', () => {
  it('exposes body-parser compatible fields', () => {
    const err = new PayloadTooLargeError(100, 200);
    expect(err.status).toBe(413);
    expect(err.type).toBe('entity.too.large');
    expect(err.limit).toBe(100);
    expect(err.length).toBe(200);
  });

  it('writes problem+json via respondPayloadTooLarge', async () => {
    const testApp = express();
    testApp.post('/x', (_req, res) => {
      respondPayloadTooLarge(res, 2048, 4096);
    });

    const res = await request(testApp).post('/x');
    expect(res.status).toBe(413);
    expect(res.headers['x-content-length-limit']).toBe('2048');
    expect(res.headers['x-content-length-received']).toBe('4096');
    expect(res.body.title).toBe('Payload Too Large');
    expect(res.body.data).toBeNull();
    expect(res.body.error).toBeTruthy();
  });

  it('errorHandler maps entity.too.large to 413 problem+json', async () => {
    const testApp = express();
    testApp.post('/x', (_req, _res, next) => {
      next(new PayloadTooLargeError(BODY_LIMIT_DEFAULT_BYTES, 999_999));
    });
    testApp.use(errorHandler);

    const res = await request(testApp).post('/x');
    expect(res.status).toBe(413);
    expect(res.body.limit).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(res.body.error).toMatch(/Payload Too Large/i);
  });
});

describe('Content-Type enforcement', () => {
  it('returns 415 when Content-Type is text/plain on a POST route', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'text/plain')
      .send('walletAddress=0x123');

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({
      data: null,
      error: expect.stringContaining('application/json'),
    });
  });

  it('returns 415 for form-encoded bodies on JSON routes', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('walletAddress=0x123');

    expect(res.status).toBe(415);
  });

  it('does not enforce Content-Type on GET requests', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('allows a valid JSON POST through', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send({ walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });

    expect(res.status).toBe(200);
  });
});
