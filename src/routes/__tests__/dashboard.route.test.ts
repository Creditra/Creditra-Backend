import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../../app.js';

describe('GET /api/dashboard/summary', () => {
  it('returns the cached dashboard summary envelope', async () => {
    const app = createApp();
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
  });

  it('reflects newly created credit lines after cache invalidation', async () => {
    const app = createApp();

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
  });
});
