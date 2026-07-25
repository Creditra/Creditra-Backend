import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeAll } from 'vitest';
import { creditRouter } from '../credit.js';
import { dashboardRouter } from '../dashboard.js';

/**
 * Mount only the routers under test. `createApp()` is incomplete on main
 * (missing maintenance/metrics imports); keep this suite self-contained.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/credit', creditRouter);
  app.use('/api/dashboard', dashboardRouter);
  return app;
}

describe('GET /api/dashboard/summary', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  it('returns the cached dashboard summary envelope', async () => {
    const res = await request(app).get('/api/dashboard/summary');

    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toMatchObject({
      totalCreditLines: expect.any(Number),
      totalCreditLimit: expect.any(String),
      totalUtilized: expect.any(String),
      totalAvailable: expect.any(String),
    });
    expect(res.body.data.generatedAt).toBeDefined();
    expect(res.body.data.countsByStatus).toBeDefined();
    // Conditional-GET headers for API-level caching
    expect(res.headers.etag).toBeDefined();
    expect(res.headers['cache-control']).toBe('private, must-revalidate');
  });

  it('reflects newly created credit lines after cache invalidation', async () => {
    const before = await request(app).get('/api/dashboard/summary');
    const beforeCount = before.body.data.totalCreditLines as number;

    await request(app)
      .post('/api/credit/lines')
      .send({
        walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        creditLimit: '1234.00',
        interestRateBps: 500,
      });

    const after = await request(app).get('/api/dashboard/summary');
    expect(after.body.data.totalCreditLines).toBe(beforeCount + 1);
    // Mutation invalidates the in-process summary and changes the ETag.
    expect(after.headers.etag).toBeDefined();
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });
});
