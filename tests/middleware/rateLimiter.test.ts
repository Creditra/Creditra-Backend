import request from 'supertest';
import { app } from '../../src/index.js';

describe('Rate Limiting Middleware', () => {
  const origEnv = { ...process.env };

  beforeAll(() => {
    process.env.RATE_LIMIT_WINDOW_MS = '200';
    process.env.RATE_LIMIT_MAX_PUBLIC = '2';
    process.env.RATE_LIMIT_ENABLED = 'true';
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test('limits GET /api/credit/lines after max requests', async () => {
    const r1 = await request(app).get('/api/credit/lines');
    expect(r1.status).toBeLessThan(429);
    const r2 = await request(app).get('/api/credit/lines');
    expect(r2.status).toBeLessThan(429);
    const r3 = await request(app).get('/api/credit/lines');
    expect(r3.status).toBe(429);
    expect(r3.body).toHaveProperty('error');
    expect(typeof r3.body.error).toBe('string');
    const retryAfter = r3.headers['retry-after'];
    expect(retryAfter).toBeDefined();
  });

  test('allows requests after window resets', async () => {
    await new Promise((res) => setTimeout(res, 250));
    const r = await request(app).get('/api/credit/lines');
    expect(r.status).toBeLessThan(429);
  });

  test('limits POST /api/risk/evaluate after max requests', async () => {
    const body = { walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    const a = await request(app).post('/api/risk/evaluate').send(body).set('Content-Type', 'application/json');
    const b = await request(app).post('/api/risk/evaluate').send(body).set('Content-Type', 'application/json');
    expect(a.status).toBeLessThan(429);
    expect(b.status).toBeLessThan(429);
    const c = await request(app).post('/api/risk/evaluate').send(body).set('Content-Type', 'application/json');
    expect(c.status).toBe(429);
    expect(c.body).toHaveProperty('error');
  });
});
