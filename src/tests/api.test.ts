import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'creditra-backend' });
  });
});

describe('GET /docs.json', () => {
  it('returns the parsed OpenAPI spec', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Creditra API');
  });
});

describe('GET /api/credit/lines', () => {
  it('returns 200 with empty creditLines array', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('creditLines');
    expect(Array.isArray(res.body.creditLines)).toBe(true);
  });
});

describe('GET /api/credit/lines/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/credit/lines/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Credit line not found');
    expect(res.body).toHaveProperty('id', 'nonexistent');
  });
});

describe('POST /api/risk/evaluate', () => {
  it('returns 400 when walletAddress is missing', async () => {
    const res = await request(app).post('/api/risk/evaluate').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'walletAddress required');
  });

  it('returns 200 with risk fields when walletAddress provided', async () => {
    const wallet = '0xAbC1234567890abcdef1234567890abcdef123456';
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: wallet });
    expect(res.status).toBe(200);
    expect(res.body.walletAddress).toBe(wallet);
    expect(res.body).toHaveProperty('riskScore');
    expect(res.body).toHaveProperty('creditLimit');
    expect(res.body).toHaveProperty('interestRateBps');
    expect(res.body).toHaveProperty('message');
  });
});