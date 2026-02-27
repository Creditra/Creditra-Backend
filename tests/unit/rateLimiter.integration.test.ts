import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { applyRateLimiters } from '../../src/middleware/rateLimiterConfig.js';
import { InMemoryStore } from '../../src/middleware/stores/InMemoryStore.js';
import { createRateLimiter } from '../../src/middleware/rateLimiter.js';

describe('Rate Limiter Integration Tests', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('Multiple Endpoints with Different Limits', () => {
    it('should enforce 20 request limit on /api/risk/evaluate in production', async () => {
      const store = new InMemoryStore();
      
      // Create production-like configuration for /api/risk/evaluate
      const riskLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: 20,
        store,
      });

      app.use('/api/risk/evaluate', riskLimiter, (req: Request, res: Response) => {
        res.status(200).json({ success: true, endpoint: 'risk/evaluate' });
      });

      // Make 20 requests - all should succeed
      for (let i = 0; i < 20; i++) {
        const res = await request(app).post('/api/risk/evaluate');
        expect(res.status).toBe(200);
        expect(res.body.endpoint).toBe('risk/evaluate');
      }

      // 21st request should be rate limited
      const res = await request(app).post('/api/risk/evaluate');
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(res.body.limit).toBe(20);

      store.destroy();
    });

    it('should enforce 100 request limit on /api/credit/lines in production', async () => {
      const store = new InMemoryStore();
      
      // Create production-like configuration for /api/credit/lines
      const creditLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: 100,
        store,
      });

      app.use('/api/credit/lines', creditLimiter, (req: Request, res: Response) => {
        res.status(200).json({ success: true, endpoint: 'credit/lines' });
      });

      // Make 100 requests - all should succeed
      for (let i = 0; i < 100; i++) {
        const res = await request(app).get('/api/credit/lines');
        expect(res.status).toBe(200);
        expect(res.body.endpoint).toBe('credit/lines');
      }

      // 101st request should be rate limited
      const res = await request(app).get('/api/credit/lines');
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(res.body.limit).toBe(100);

      store.destroy();
    });
  });

  describe('Independent Counters for Different Endpoints', () => {
    it('should maintain independent counters for /api/risk/evaluate and /api/credit/lines from same client', async () => {
      const store = new InMemoryStore();
      
      // Create limiters with different limits
      const riskLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: 20,
        store,
      });

      const creditLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: 100,
        store,
      });

      app.use('/api/risk/evaluate', riskLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'risk' });
      });

      app.use('/api/credit/lines', creditLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'credit' });
      });

      // Make 20 requests to /api/risk/evaluate
      for (let i = 0; i < 20; i++) {
        const res = await request(app).post('/api/risk/evaluate');
        expect(res.status).toBe(200);
      }

      // /api/risk/evaluate should be rate limited
      const riskRes = await request(app).post('/api/risk/evaluate');
      expect(riskRes.status).toBe(429);

      // /api/credit/lines should still work (independent counter)
      const creditRes = await request(app).get('/api/credit/lines');
      expect(creditRes.status).toBe(200);
      expect(creditRes.body.endpoint).toBe('credit');

      store.destroy();
    });

    it('should allow full quota on each endpoint independently', async () => {
      const store = new InMemoryStore();
      
      const riskLimiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        store,
      });

      const creditLimiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/api/risk/evaluate', riskLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'risk' });
      });

      app.use('/api/credit/lines', creditLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'credit' });
      });

      // Use full quota on risk endpoint
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/risk/evaluate');
        expect(res.status).toBe(200);
      }

      // Use full quota on credit endpoint
      for (let i = 0; i < 10; i++) {
        const res = await request(app).get('/api/credit/lines');
        expect(res.status).toBe(200);
      }

      // Both should now be rate limited
      const riskRes = await request(app).post('/api/risk/evaluate');
      expect(riskRes.status).toBe(429);

      const creditRes = await request(app).get('/api/credit/lines');
      expect(creditRes.status).toBe(429);

      store.destroy();
    });
  });

  describe('Shared Store Across Multiple Middleware Instances', () => {
    it('should use shared store for all endpoints', async () => {
      const sharedStore = new InMemoryStore();
      
      const limiter1 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        store: sharedStore,
      });

      const limiter2 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        store: sharedStore,
      });

      const limiter3 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store: sharedStore,
      });

      app.use('/api/endpoint1', limiter1, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 1 });
      });

      app.use('/api/endpoint2', limiter2, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 2 });
      });

      app.use('/api/endpoint3', limiter3, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 3 });
      });

      // Each endpoint should have its own counter in the shared store
      // Endpoint 1: 3 requests allowed
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/api/endpoint1');
        expect(res.status).toBe(200);
      }
      const res1 = await request(app).get('/api/endpoint1');
      expect(res1.status).toBe(429);

      // Endpoint 2: 5 requests allowed (independent of endpoint 1)
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/api/endpoint2');
        expect(res.status).toBe(200);
      }
      const res2 = await request(app).get('/api/endpoint2');
      expect(res2.status).toBe(429);

      // Endpoint 3: 2 requests allowed (independent of others)
      for (let i = 0; i < 2; i++) {
        const res = await request(app).get('/api/endpoint3');
        expect(res.status).toBe(200);
      }
      const res3 = await request(app).get('/api/endpoint3');
      expect(res3.status).toBe(429);

      sharedStore.destroy();
    });

    it('should share store instance across applyRateLimiters', async () => {
      // Apply rate limiters using the config function (production mode)
      applyRateLimiters(app, 'production');

      // Add route handlers
      app.post('/api/risk/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'risk' });
      });

      app.get('/api/credit/lines', (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'credit' });
      });

      // Test that both endpoints work independently
      const riskRes = await request(app).post('/api/risk/evaluate');
      expect(riskRes.status).toBe(200);

      const creditRes = await request(app).get('/api/credit/lines');
      expect(creditRes.status).toBe(200);

      // Verify rate limit headers are present
      expect(riskRes.headers['x-ratelimit-limit']).toBe('20');
      expect(creditRes.headers['x-ratelimit-limit']).toBe('100');
    });
  });

  describe('Rate Limit Headers on Different Endpoints', () => {
    it('should set correct rate limit headers for each endpoint', async () => {
      const store = new InMemoryStore();
      
      const riskLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: 20,
        store,
      });

      const creditLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        maxRequests: 100,
        store,
      });

      app.use('/api/risk/evaluate', riskLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'risk' });
      });

      app.use('/api/credit/lines', creditLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'credit' });
      });

      // Check risk endpoint headers
      const riskRes = await request(app).post('/api/risk/evaluate');
      expect(riskRes.headers['x-ratelimit-limit']).toBe('20');
      expect(riskRes.headers['x-ratelimit-remaining']).toBe('19');
      expect(riskRes.headers['x-ratelimit-reset']).toBeDefined();

      // Check credit endpoint headers
      const creditRes = await request(app).get('/api/credit/lines');
      expect(creditRes.headers['x-ratelimit-limit']).toBe('100');
      expect(creditRes.headers['x-ratelimit-remaining']).toBe('99');
      expect(creditRes.headers['x-ratelimit-reset']).toBeDefined();

      store.destroy();
    });

    it('should update remaining count correctly for each endpoint', async () => {
      const store = new InMemoryStore();
      
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        store,
      });

      app.use('/api/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Track remaining count
      const res1 = await request(app).get('/api/test');
      expect(res1.headers['x-ratelimit-remaining']).toBe('4');

      const res2 = await request(app).get('/api/test');
      expect(res2.headers['x-ratelimit-remaining']).toBe('3');

      const res3 = await request(app).get('/api/test');
      expect(res3.headers['x-ratelimit-remaining']).toBe('2');

      store.destroy();
    });
  });

  describe('429 Responses on Different Endpoints', () => {
    it('should return correct 429 response for /api/risk/evaluate', async () => {
      const store = new InMemoryStore();
      
      const riskLimiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store,
      });

      app.use('/api/risk/evaluate', riskLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'risk' });
      });

      // Exhaust quota
      await request(app).post('/api/risk/evaluate');
      await request(app).post('/api/risk/evaluate');

      // Get 429 response
      const res = await request(app).post('/api/risk/evaluate');
      
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(res.body.limit).toBe(2);
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBe('0');

      store.destroy();
    });

    it('should return correct 429 response for /api/credit/lines', async () => {
      const store = new InMemoryStore();
      
      const creditLimiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        store,
      });

      app.use('/api/credit/lines', creditLimiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 'credit' });
      });

      // Exhaust quota
      await request(app).get('/api/credit/lines');
      await request(app).get('/api/credit/lines');
      await request(app).get('/api/credit/lines');

      // Get 429 response
      const res = await request(app).get('/api/credit/lines');
      
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(res.body.limit).toBe(3);
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBe('0');

      store.destroy();
    });

    it('should return 429 independently for each endpoint', async () => {
      const store = new InMemoryStore();
      
      const limiter1 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      const limiter2 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store,
      });

      app.use('/api/endpoint1', limiter1, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 1 });
      });

      app.use('/api/endpoint2', limiter2, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 2 });
      });

      // Exhaust endpoint1
      await request(app).get('/api/endpoint1');
      const res1 = await request(app).get('/api/endpoint1');
      expect(res1.status).toBe(429);
      expect(res1.body.limit).toBe(1);

      // Endpoint2 should still work
      const res2 = await request(app).get('/api/endpoint2');
      expect(res2.status).toBe(200);

      // Exhaust endpoint2
      await request(app).get('/api/endpoint2');
      const res3 = await request(app).get('/api/endpoint2');
      expect(res3.status).toBe(429);
      expect(res3.body.limit).toBe(2);

      store.destroy();
    });
  });

  describe('Full Stack Integration with applyRateLimiters', () => {
    it('should apply rate limiters to all configured endpoints', async () => {
      // Apply rate limiters with production config
      applyRateLimiters(app, 'production');

      // Add actual route handlers
      app.post('/api/risk/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ success: true, service: 'risk' });
      });

      app.get('/api/credit/lines', (req: Request, res: Response) => {
        res.status(200).json({ success: true, service: 'credit' });
      });

      app.get('/api/credit/lines/:id', (req: Request, res: Response) => {
        res.status(200).json({ success: true, service: 'credit', id: req.params.id });
      });

      // Test risk endpoint
      const riskRes = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: '0x123' });
      
      expect(riskRes.status).toBe(200);
      expect(riskRes.headers['x-ratelimit-limit']).toBe('20');

      // Test credit lines endpoint
      const creditRes = await request(app).get('/api/credit/lines');
      expect(creditRes.status).toBe(200);
      expect(creditRes.headers['x-ratelimit-limit']).toBe('100');

      // Test credit line by ID endpoint
      const creditIdRes = await request(app).get('/api/credit/lines/123');
      expect(creditIdRes.status).toBe(200);
      expect(creditIdRes.headers['x-ratelimit-limit']).toBe('100');
    });

    it('should use development limits when environment is development', async () => {
      applyRateLimiters(app, 'development');

      app.post('/api/risk/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ success: true });
      });

      app.get('/api/credit/lines', (req: Request, res: Response) => {
        res.status(200).json({ success: true });
      });

      // Development should have higher limits
      const riskRes = await request(app).post('/api/risk/evaluate');
      expect(riskRes.headers['x-ratelimit-limit']).toBe('200');

      const creditRes = await request(app).get('/api/credit/lines');
      expect(creditRes.headers['x-ratelimit-limit']).toBe('1000');
    });
  });

  describe('Concurrent Requests to Multiple Endpoints', () => {
    it('should handle concurrent requests to different endpoints correctly', async () => {
      const store = new InMemoryStore();
      
      const limiter1 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      const limiter2 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/api/endpoint1', limiter1, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 1 });
      });

      app.use('/api/endpoint2', limiter2, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 2 });
      });

      // Make concurrent requests to both endpoints
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(request(app).get('/api/endpoint1'));
        promises.push(request(app).get('/api/endpoint2'));
      }

      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(res => {
        expect(res.status).toBe(200);
      });

      // Both endpoints should still have quota remaining
      const res1 = await request(app).get('/api/endpoint1');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-ratelimit-remaining']).toBe('4');

      const res2 = await request(app).get('/api/endpoint2');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('4');

      store.destroy();
    });
  });
});
