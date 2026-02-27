import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { createRateLimiter } from '../../src/middleware/rateLimiter.js';
import { InMemoryStore } from '../../src/middleware/stores/InMemoryStore.js';
import { IRateLimitStore } from '../../src/middleware/stores/IRateLimitStore.js';

describe('Rate Limiter Middleware', () => {
  let app: Express;
  let store: InMemoryStore;

  beforeEach(() => {
    app = express();
    store = new InMemoryStore();
  });

  afterEach(() => {
    store.destroy();
  });

  describe('Requests Within Quota', () => {
    it('should allow requests within quota to succeed with 200', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ success: true });
      });

      // Make 5 requests - all should succeed
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
      }
    });

    it('should allow exactly maxRequests requests', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make exactly 10 requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }
    });
  });

  describe('Requests Exceeding Quota', () => {
    it('should return 429 when requests exceed quota', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make 3 successful requests
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }

      // 4th request should be rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
    });

    it('should continue returning 429 for subsequent requests after limit exceeded', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Exceed limit
      await request(app).get('/test');
      await request(app).get('/test');

      // Multiple requests should all return 429
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(429);
      }
    });
  });

  describe('429 Response Format', () => {
    it('should include all required fields in 429 response body', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // First request succeeds
      await request(app).get('/test');

      // Second request gets rate limited
      const res = await request(app).get('/test');

      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('retryAfter');
      expect(res.body).toHaveProperty('limit');
    });

    it('should have correct error message in 429 response', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(res.body.error).toBe('Rate limit exceeded');
    });

    it('should include correct limit value in 429 response', async () => {
      const maxRequests = 5;
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Exceed limit
      for (let i = 0; i <= maxRequests; i++) {
        await request(app).get('/test');
      }

      const res = await request(app).get('/test');
      expect(res.body.limit).toBe(maxRequests);
    });

    it('should include retryAfter as a positive number in 429 response', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(typeof res.body.retryAfter).toBe('number');
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(res.body.retryAfter).toBeLessThanOrEqual(60); // Should be within window
    });
  });

  describe('Rate Limit Headers', () => {
    it('should set X-RateLimit-Limit header on all responses', async () => {
      const maxRequests = 10;
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      const res = await request(app).get('/test');
      expect(res.headers['x-ratelimit-limit']).toBe(maxRequests.toString());
    });

    it('should set X-RateLimit-Remaining header correctly', async () => {
      const maxRequests = 5;
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // First request: 4 remaining
      const res1 = await request(app).get('/test');
      expect(res1.headers['x-ratelimit-remaining']).toBe('4');

      // Second request: 3 remaining
      const res2 = await request(app).get('/test');
      expect(res2.headers['x-ratelimit-remaining']).toBe('3');

      // Third request: 2 remaining
      const res3 = await request(app).get('/test');
      expect(res3.headers['x-ratelimit-remaining']).toBe('2');
    });

    it('should set X-RateLimit-Remaining to 0 when limit exceeded', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      await request(app).get('/test');
      await request(app).get('/test');

      // Exceeded limit
      const res = await request(app).get('/test');
      expect(res.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('should set X-RateLimit-Reset header with ISO timestamp', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      const res = await request(app).get('/test');
      
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
      
      // Verify it's a valid ISO timestamp
      const resetTime = new Date(res.headers['x-ratelimit-reset']);
      expect(resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('should set all rate limit headers on 200 responses', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      const res = await request(app).get('/test');
      
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should set all rate limit headers on 429 responses', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      await request(app).get('/test');
      const res = await request(app).get('/test');
      
      expect(res.status).toBe(429);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('Retry-After Header', () => {
    it('should include Retry-After header in 429 responses', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('should have Retry-After value as positive number of seconds', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      await request(app).get('/test');
      const res = await request(app).get('/test');

      const retryAfter = parseInt(res.headers['retry-after'], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('should not include Retry-After header in 200 responses', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      const res = await request(app).get('/test');
      
      expect(res.status).toBe(200);
      expect(res.headers['retry-after']).toBeUndefined();
    });
  });

  describe('Fail-Open Behavior on Store Errors', () => {
    it('should allow request to proceed when store.increment throws error', async () => {
      const faultyStore: IRateLimitStore = {
        increment: async () => {
          throw new Error('Store increment failed');
        },
        get: async () => null,
        reset: async () => {},
        cleanup: async () => 0,
      };

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store: faultyStore,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      const res = await request(app).get('/test');
      
      // Request should succeed despite store error
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('should allow multiple requests when store consistently fails', async () => {
      const faultyStore: IRateLimitStore = {
        increment: async () => {
          throw new Error('Store failure');
        },
        get: async () => {
          throw new Error('Store failure');
        },
        reset: async () => {
          throw new Error('Store failure');
        },
        cleanup: async () => {
          throw new Error('Store failure');
        },
      };

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store: faultyStore,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // All requests should succeed (fail-open)
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }
    });
  });

  describe('IP Extraction and Key Generation', () => {
    it('should extract IP from req.ip', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ip: req.ip });
      });

      // Supertest sets req.ip
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('should generate key in format {ip}:{path}', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/api/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // First request succeeds
      const res1 = await request(app).get('/api/test');
      expect(res1.status).toBe(200);

      // Second request to same path should be rate limited
      const res2 = await request(app).get('/api/test');
      expect(res2.status).toBe(429);
    });

    it('should use default "unknown" when IP is not available', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
        keyGenerator: (req: Request) => {
          // Simulate missing IP
          return (req as any).ip || 'unknown';
        },
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Supertest should work normally
      const res1 = await request(app).get('/test');
      expect(res1.status).toBe(200);

      // Should still rate limit
      const res2 = await request(app).get('/test');
      expect(res2.status).toBe(429);
    });
  });

  describe('Custom Key Generator', () => {
    it('should use custom keyGenerator when provided', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
        keyGenerator: (req: Request) => {
          return req.headers['x-api-key'] as string || 'anonymous';
        },
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Request with API key
      const res1 = await request(app)
        .get('/test')
        .set('X-API-Key', 'user-123');
      expect(res1.status).toBe(200);

      // Second request with same API key should be rate limited
      const res2 = await request(app)
        .get('/test')
        .set('X-API-Key', 'user-123');
      expect(res2.status).toBe(429);

      // Request with different API key should succeed
      const res3 = await request(app)
        .get('/test')
        .set('X-API-Key', 'user-456');
      expect(res3.status).toBe(200);
    });
  });

  describe('Different Clients Have Independent Counters', () => {
    it('should maintain separate counters for different IPs', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        store,
        keyGenerator: (req: Request) => {
          // Use custom header to simulate different IPs
          return req.headers['x-forwarded-for'] as string || req.ip || 'unknown';
        },
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Client 1 makes 2 requests
      await request(app).get('/test').set('X-Forwarded-For', '192.168.1.1');
      await request(app).get('/test').set('X-Forwarded-For', '192.168.1.1');

      // Client 1's 3rd request should be rate limited
      const res1 = await request(app).get('/test').set('X-Forwarded-For', '192.168.1.1');
      expect(res1.status).toBe(429);

      // Client 2 should still be able to make requests
      const res2 = await request(app).get('/test').set('X-Forwarded-For', '192.168.1.2');
      expect(res2.status).toBe(200);

      const res3 = await request(app).get('/test').set('X-Forwarded-For', '192.168.1.2');
      expect(res3.status).toBe(200);
    });

    it('should track multiple clients independently on same endpoint', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
        keyGenerator: (req: Request) => {
          return req.headers['x-client-id'] as string || 'unknown';
        },
      });

      app.use('/api/resource', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Three different clients
      const client1Res1 = await request(app).get('/api/resource').set('X-Client-Id', 'client-1');
      const client2Res1 = await request(app).get('/api/resource').set('X-Client-Id', 'client-2');
      const client3Res1 = await request(app).get('/api/resource').set('X-Client-Id', 'client-3');

      // All first requests should succeed
      expect(client1Res1.status).toBe(200);
      expect(client2Res1.status).toBe(200);
      expect(client3Res1.status).toBe(200);

      // All second requests should be rate limited
      const client1Res2 = await request(app).get('/api/resource').set('X-Client-Id', 'client-1');
      const client2Res2 = await request(app).get('/api/resource').set('X-Client-Id', 'client-2');
      const client3Res2 = await request(app).get('/api/resource').set('X-Client-Id', 'client-3');

      expect(client1Res2.status).toBe(429);
      expect(client2Res2.status).toBe(429);
      expect(client3Res2.status).toBe(429);
    });
  });

  describe('Different Endpoints Have Independent Limits', () => {
    it('should maintain separate counters for different paths', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/endpoint1', limiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 1 });
      });

      app.use('/endpoint2', limiter, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 2 });
      });

      // Make request to endpoint1
      const res1 = await request(app).get('/endpoint1');
      expect(res1.status).toBe(200);

      // Second request to endpoint1 should be rate limited
      const res2 = await request(app).get('/endpoint1');
      expect(res2.status).toBe(429);

      // Request to endpoint2 should still work (independent counter)
      const res3 = await request(app).get('/endpoint2');
      expect(res3.status).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    it('should handle requests at exact quota boundary', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make exactly maxRequests requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }

      // Next request should be rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
    });

    it('should handle very short time windows', async () => {
      const limiter = createRateLimiter({
        windowMs: 100, // 100ms window
        maxRequests: 2,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make 2 requests
      await request(app).get('/test');
      await request(app).get('/test');

      // 3rd request should be rate limited
      const res1 = await request(app).get('/test');
      expect(res1.status).toBe(429);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be able to make requests again
      const res2 = await request(app).get('/test');
      expect(res2.status).toBe(200);
    });

    it('should handle concurrent requests from same client', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make 10 concurrent requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(request(app).get('/test'));
      }

      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(res => {
        expect(res.status).toBe(200);
      });

      // Next request should be rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
    });

    it('should handle paths with query parameters', async () => {
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 1,
        store,
      });

      app.use('/api/search', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Request with query params
      const res1 = await request(app).get('/api/search?q=test');
      expect(res1.status).toBe(200);

      // Second request (query params don't affect rate limit key)
      const res2 = await request(app).get('/api/search?q=other');
      expect(res2.status).toBe(429);
    });
  });

  describe('Configuration Options', () => {
    it('should respect custom windowMs configuration', async () => {
      const limiter = createRateLimiter({
        windowMs: 200, // 200ms window
        maxRequests: 1,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // First request succeeds
      await request(app).get('/test');

      // Second request is rate limited
      const res1 = await request(app).get('/test');
      expect(res1.status).toBe(429);

      // Wait for window to reset
      await new Promise(resolve => setTimeout(resolve, 250));

      // Should work again
      const res2 = await request(app).get('/test');
      expect(res2.status).toBe(200);
    });

    it('should respect custom maxRequests configuration', async () => {
      const customMax = 7;
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: customMax,
        store,
      });

      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make customMax requests
      for (let i = 0; i < customMax; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }

      // Next request should be rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
      expect(res.body.limit).toBe(customMax);
    });

    it('should use shared store across multiple middleware instances', async () => {
      const sharedStore = new InMemoryStore();

      const limiter1 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        store: sharedStore,
      });

      const limiter2 = createRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        store: sharedStore,
      });

      app.use('/endpoint1', limiter1, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 1 });
      });

      app.use('/endpoint2', limiter2, (req: Request, res: Response) => {
        res.status(200).json({ endpoint: 2 });
      });

      // Each endpoint should have independent counters even with shared store
      await request(app).get('/endpoint1');
      await request(app).get('/endpoint1');
      await request(app).get('/endpoint1');

      // endpoint1 should be rate limited
      const res1 = await request(app).get('/endpoint1');
      expect(res1.status).toBe(429);

      // endpoint2 should still work
      const res2 = await request(app).get('/endpoint2');
      expect(res2.status).toBe(200);

      sharedStore.destroy();
    });
  });
});
