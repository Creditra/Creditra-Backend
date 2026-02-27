import request from 'supertest';
import { app } from '../../src/index.js';

describe('Rate Limiting Middleware (extra)', () => {
  const origEnv = { ...process.env };

  beforeAll(() => {
    process.env.RATE_LIMIT_WINDOW_MS = '200';
    process.env.RATE_LIMIT_MAX_PUBLIC = '1';
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MESSAGE = 'Too many requests';
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test('custom 429 message is returned', async () => {
    const okRes = await request(app).get('/api/credit/lines');
    expect(okRes.status).toBeLessThan(429);
    const limited = await request(app).get('/api/credit/lines');
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('Too many requests');
    const retryAfter = limited.headers['retry-after'];
    expect(retryAfter).toBeDefined();
  });

  test('disabled limiter allows all requests', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    const a = await request(app).get('/api/credit/lines');
    const b = await request(app).get('/api/credit/lines');
    const c = await request(app).get('/api/credit/lines');
    expect(a.status).toBeLessThan(429);
    expect(b.status).toBeLessThan(429);
    expect(c.status).toBeLessThan(429);
  });
});
