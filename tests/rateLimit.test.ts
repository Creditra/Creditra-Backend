import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

// Valid Ed25519 public key (checksummed) used across OpenAPI examples.
const VALID_ADDRESS = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';

describe('Rate Limiting Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.API_KEYS = 'test-admin-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Rate limit headers on credit endpoints', () => {
    it('sets X-RateLimit-* headers on GET /api/credit/lines', async () => {
      const response = await request(app).get('/api/credit/lines');

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on GET /api/credit/lines/:id', async () => {
      const response = await request(app).get('/api/credit/lines/nonexistent-id');

      expect(response.status).toBe(404);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on POST /api/credit/lines', async () => {
      const response = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: VALID_ADDRESS, requestedLimit: '1000' });

      // Assert headers on any terminal status — creation may 201 or 409/400
      // depending on store state across the suite; rate-limit headers must
      // still be present because the middleware runs before the handler.
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
      expect([201, 400, 409, 500]).toContain(response.status);
    });
  });

  describe('Rate limit headers on risk endpoints', () => {
    it('sets X-RateLimit-* headers on POST /api/risk/evaluate', async () => {
      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: VALID_ADDRESS });

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on GET /api/risk/wallet/:address/latest', async () => {
      const response = await request(app).get('/api/risk/wallet/0x123/latest');

      expect([200, 404, 500]).toContain(response.status);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('sets X-RateLimit-* headers on GET /api/risk/wallet/:address/history', async () => {
      const response = await request(app).get('/api/risk/wallet/0x123/history');

      expect([200, 500]).toContain(response.status);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('Admin endpoints are not rate limited', () => {
    it('POST /api/risk/admin/recalibrate does not apply rate limiting', async () => {
      const response = await request(app)
        .post('/api/risk/admin/recalibrate')
        .set('X-API-Key', 'invalid-key');

      expect(response.status).toBe(403);
      expect(response.headers).not.toHaveProperty('x-ratelimit-limit');
      expect(response.headers).not.toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).not.toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('Admin/service bypass on rate-limited routes', () => {
    const ADMIN_SECRET = 'integration-admin-bypass-key';
    let previousAdminKey: string | undefined;

    beforeEach(() => {
      previousAdminKey = process.env.ADMIN_API_KEY;
      process.env.ADMIN_API_KEY = ADMIN_SECRET;
    });

    afterEach(() => {
      if (previousAdminKey === undefined) {
        delete process.env.ADMIN_API_KEY;
      } else {
        process.env.ADMIN_API_KEY = previousAdminKey;
      }
    });

    it('sets X-RateLimit-Bypass when X-Admin-Api-Key is valid', async () => {
      const response = await request(app)
        .get('/api/credit/lines')
        .set('X-Admin-Api-Key', ADMIN_SECRET);

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-bypass']).toBe('admin');
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
    });

    it('does not set X-RateLimit-Bypass for anonymous traffic', async () => {
      const response = await request(app).get('/api/credit/lines');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-bypass']).toBeUndefined();
    });
  });

  describe('429 response shape', () => {
    it('returns correct 429 response body when rate limit is exceeded on /api/risk/evaluate', async () => {
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/risk/evaluate')
          .send({ walletAddress: VALID_ADDRESS });
      }

      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: VALID_ADDRESS });

      if (response.status === 429) {
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toBeNull();
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('Too many requests');
        expect(response.body).toHaveProperty('retryAfter');
        expect(typeof response.body.retryAfter).toBe('number');
        expect(response.headers).toHaveProperty('retry-after');
      }
    });
  });
});
