/**
 * Integration-level response contract checks.
 * Uses assertMatchesSchema so API drift fails the suite even when
 * ENABLE_RESPONSE_VALIDATION is off for handlers.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { assertMatchesSchema } from '../src/middleware/validate.js';
import {
  envelopedHealthSchema,
  envelopedCreditLinesListSchema,
  envelopedRiskResultSchema,
  errorEnvelopeSchema,
} from '../src/schemas/index.js';

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

describe('API response contracts (Zod)', () => {
  it('GET /health matches health envelope schema', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    assertMatchesSchema(envelopedHealthSchema, res.body, 'GET /health');
  });

  it('GET /api/credit/lines matches list envelope schema', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(res.status).toBe(200);
    assertMatchesSchema(envelopedCreditLinesListSchema, res.body, 'GET /api/credit/lines');
  });

  it('POST /api/risk/evaluate success matches risk result schema', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: VALID_ADDRESS });
    expect(res.status).toBe(200);
    assertMatchesSchema(envelopedRiskResultSchema, res.body, 'POST /api/risk/evaluate');
  });

  it('POST /api/risk/evaluate validation failure matches error envelope', async () => {
    const res = await request(app).post('/api/risk/evaluate').send({});
    expect(res.status).toBe(400);
    assertMatchesSchema(errorEnvelopeSchema, res.body, 'POST /api/risk/evaluate 400');
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects unknown keys on evaluate with field details', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: VALID_ADDRESS, extra: true });
    expect(res.status).toBe(400);
    expect(res.body.data).toBeNull();
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('GET /api/credit/wallet/:wallet/lines validates wallet path param', async () => {
    const bad = await request(app).get('/api/credit/wallet/not-a-wallet/lines');
    expect(bad.status).toBe(400);
    assertMatchesSchema(errorEnvelopeSchema, bad.body, 'invalid wallet param');

    const good = await request(app).get(`/api/credit/wallet/${VALID_ADDRESS}/lines`);
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ data: { creditLines: expect.any(Array) }, error: null });
  });
});
