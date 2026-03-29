import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { evaluationStore } from '../risk.js';

const app = createApp();

// Valid UUID v4 that will never exist in the store
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
// Malformed IDs
const BAD_IDS = ['not-a-uuid', '123', 'abc-def', ''];

beforeEach(() => {
  // Reset store between tests to avoid cross-test pollution
  evaluationStore.clear();
});

// ---------------------------------------------------------------------------
// SUCCESS
// ---------------------------------------------------------------------------
describe('GET /api/risk/evaluations/:id — success', () => {
  it('returns 200 with the evaluation when a valid ID exists', async () => {
    // Seed the store directly
    const id = '11111111-1111-4111-8111-111111111111';
    evaluationStore.set(id, {
      id,
      walletAddress: '0xABC',
      riskScore: 42,
      creditLimit: '1000',
      interestRateBps: 500,
    });

    const res = await request(app).get(`/api/risk/evaluations/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.evaluation).toMatchObject({ id, walletAddress: '0xABC' });
    // Must NOT contain error key
    expect(res.body.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NOT FOUND
// ---------------------------------------------------------------------------
describe('GET /api/risk/evaluations/:id — not found', () => {
  it('returns 404 with NOT_FOUND code for a valid UUID that does not exist', async () => {
    const res = await request(app).get(`/api/risk/evaluations/${MISSING_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Risk evaluation not found' },
    });
  });
});

// ---------------------------------------------------------------------------
// INVALID INPUT
// ---------------------------------------------------------------------------
describe('GET /api/risk/evaluations/:id — invalid input', () => {
  it.each(BAD_IDS.filter(Boolean))(
    'returns 400 with INVALID_INPUT for malformed id "%s"',
    async (badId) => {
      const res = await request(app).get(`/api/risk/evaluations/${badId}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid evaluation id format',
        },
      });
    },
  );
});

// ---------------------------------------------------------------------------
// INTERNAL ERROR (simulated DB failure)
// ---------------------------------------------------------------------------
describe('GET /api/risk/evaluations/:id — internal error', () => {
  it('returns 500 with INTERNAL_ERROR and no stack trace when store throws', async () => {
    const id = '22222222-2222-4222-8222-222222222222';

    // Force the store to throw on .get()
    vi.spyOn(evaluationStore, 'get').mockImplementationOnce(() => {
      throw new Error('DB connection lost');
    });

    const res = await request(app).get(`/api/risk/evaluations/${id}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });

    // Security: no stack trace or internal details in response
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('stack');
    expect(body).not.toContain('DB connection lost');
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('src/routes');
  });
});

// ---------------------------------------------------------------------------
// SECURITY — stack trace / internal path leak assertions
// ---------------------------------------------------------------------------
describe('Security — no internal leaks in any error response', () => {
  it('404 response does not contain stack, error.stack, or internal paths', async () => {
    const res = await request(app).get(`/api/risk/evaluations/${MISSING_ID}`);
    const raw = JSON.stringify(res.body);

    expect(raw).not.toContain('stack');
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('src/');
    expect(raw).not.toContain('Error:');
  });

  it('400 response does not contain stack or internal paths', async () => {
    const res = await request(app).get('/api/risk/evaluations/bad-id');
    const raw = JSON.stringify(res.body);

    expect(raw).not.toContain('stack');
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('src/');
  });
});

// ---------------------------------------------------------------------------
// POST /evaluate — existing route still works (no regression)
// ---------------------------------------------------------------------------
describe('POST /api/risk/evaluate — regression', () => {
  it('returns 400 when walletAddress is missing', async () => {
    const res = await request(app).post('/api/risk/evaluate').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when body is absent entirely', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .set('Content-Type', 'application/json')
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 200 with a valid walletAddress', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: '0xDEAD' });

    expect(res.status).toBe(200);
    expect(res.body.walletAddress).toBe('0xDEAD');
  });
});
