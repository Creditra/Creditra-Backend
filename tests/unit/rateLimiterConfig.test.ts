import { describe, it, expect } from 'vitest';
import { getRateLimitConfig, createEndpointRateLimiter, applyRateLimiters, applyRateLimiterToRouter } from '../../src/middleware/rateLimiterConfig.js';
import { InMemoryStore } from '../../src/middleware/stores/InMemoryStore.js';
import express, { Express, Router, Request, Response } from 'express';
import request from 'supertest';

describe('Rate Limiter Configuration Module', () => {
  describe('getRateLimitConfig', () => {
    it('should return correct config for development environment', () => {
      const config = getRateLimitConfig('development');

      expect(config.defaultWindowMs).toBe(15 * 60 * 1000);
      expect(config.defaultMaxRequests).toBe(1000);
      expect(config.endpoints).toHaveLength(3);

      const riskEndpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
      expect(riskEndpoint).toBeDefined();
      expect(riskEndpoint?.maxRequests).toBe(200);
      expect(riskEndpoint?.windowMs).toBe(15 * 60 * 1000);

      const creditLinesEndpoint = config.endpoints.find(e => e.path === '/api/credit/lines');
      expect(creditLinesEndpoint).toBeDefined();
      expect(creditLinesEndpoint?.maxRequests).toBe(1000);
      expect(creditLinesEndpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should return correct config for staging environment', () => {
      const config = getRateLimitConfig('staging');

      expect(config.defaultWindowMs).toBe(15 * 60 * 1000);
      expect(config.defaultMaxRequests).toBe(100);
      expect(config.endpoints).toHaveLength(3);

      const riskEndpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
      expect(riskEndpoint).toBeDefined();
      expect(riskEndpoint?.maxRequests).toBe(20);
      expect(riskEndpoint?.windowMs).toBe(15 * 60 * 1000);

      const creditLinesEndpoint = config.endpoints.find(e => e.path === '/api/credit/lines');
      expect(creditLinesEndpoint).toBeDefined();
      expect(creditLinesEndpoint?.maxRequests).toBe(100);
      expect(creditLinesEndpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should return correct config for production environment', () => {
      const config = getRateLimitConfig('production');

      expect(config.defaultWindowMs).toBe(15 * 60 * 1000);
      expect(config.defaultMaxRequests).toBe(100);
      expect(config.endpoints).toHaveLength(3);

      const riskEndpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
      expect(riskEndpoint).toBeDefined();
      expect(riskEndpoint?.maxRequests).toBe(20);
      expect(riskEndpoint?.windowMs).toBe(15 * 60 * 1000);

      const creditLinesEndpoint = config.endpoints.find(e => e.path === '/api/credit/lines');
      expect(creditLinesEndpoint).toBeDefined();
      expect(creditLinesEndpoint?.maxRequests).toBe(100);
      expect(creditLinesEndpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should fallback to development config for unknown environment', () => {
      const config = getRateLimitConfig('unknown-env');

      expect(config.defaultWindowMs).toBe(15 * 60 * 1000);
      expect(config.defaultMaxRequests).toBe(1000);
      expect(config.endpoints).toHaveLength(3);

      const riskEndpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
      expect(riskEndpoint?.maxRequests).toBe(200);
    });

    it('should use development config when no environment specified', () => {
      const config = getRateLimitConfig();

      expect(config.defaultMaxRequests).toBe(1000);
      const riskEndpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
      expect(riskEndpoint?.maxRequests).toBe(200);
    });
  });

  describe('Specific Endpoint Configurations', () => {
    it('should configure POST /api/risk/evaluate with 20 req limit in production', () => {
      const config = getRateLimitConfig('production');
      const endpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');

      expect(endpoint).toBeDefined();
      expect(endpoint?.path).toBe('/api/risk/evaluate');
      expect(endpoint?.maxRequests).toBe(20);
      expect(endpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should configure GET /api/credit/lines with 100 req limit in production', () => {
      const config = getRateLimitConfig('production');
      const endpoint = config.endpoints.find(e => e.path === '/api/credit/lines');

      expect(endpoint).toBeDefined();
      expect(endpoint?.path).toBe('/api/credit/lines');
      expect(endpoint?.maxRequests).toBe(100);
      expect(endpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should configure /api/risk/evaluate with 200 req limit in development', () => {
      const config = getRateLimitConfig('development');
      const endpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');

      expect(endpoint).toBeDefined();
      expect(endpoint?.maxRequests).toBe(200);
      expect(endpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should configure /api/credit/lines with 1000 req limit in development', () => {
      const config = getRateLimitConfig('development');
      const endpoint = config.endpoints.find(e => e.path === '/api/credit/lines');

      expect(endpoint).toBeDefined();
      expect(endpoint?.maxRequests).toBe(1000);
      expect(endpoint?.windowMs).toBe(15 * 60 * 1000);
    });

    it('should have higher limits in development than production', () => {
      const devConfig = getRateLimitConfig('development');
      const prodConfig = getRateLimitConfig('production');

      const devRisk = devConfig.endpoints.find(e => e.path === '/api/risk/evaluate');
      const prodRisk = prodConfig.endpoints.find(e => e.path === '/api/risk/evaluate');

      expect(devRisk?.maxRequests).toBeGreaterThan(prodRisk?.maxRequests || 0);

      const devCredit = devConfig.endpoints.find(e => e.path === '/api/credit/lines');
      const prodCredit = prodConfig.endpoints.find(e => e.path === '/api/credit/lines');

      expect(devCredit?.maxRequests).toBeGreaterThan(prodCredit?.maxRequests || 0);
    });

    it('should include all three required endpoints in each environment', () => {
      const environments = ['development', 'staging', 'production'];
      const requiredPaths = ['/api/risk/evaluate', '/api/credit/lines', '/api/credit/lines/:id'];

      environments.forEach(env => {
        const config = getRateLimitConfig(env);
        requiredPaths.forEach(path => {
          const endpoint = config.endpoints.find(e => e.path === path);
          expect(endpoint).toBeDefined();
          expect(endpoint?.path).toBe(path);
        });
      });
    });
  });

  describe('createEndpointRateLimiter', () => {
    it('should create a working rate limiter middleware from endpoint config', async () => {
      const app = express();
      const store = new InMemoryStore();

      const endpoint = {
        path: '/test',
        windowMs: 60000,
        maxRequests: 3,
      };

      const limiter = createEndpointRateLimiter(endpoint, store);
      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make 3 requests - should succeed
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }

      // 4th request should be rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);

      store.destroy();
    });

    it('should respect endpoint windowMs configuration', async () => {
      const app = express();
      const store = new InMemoryStore();

      const endpoint = {
        path: '/test',
        windowMs: 100, // Very short window
        maxRequests: 1,
      };

      const limiter = createEndpointRateLimiter(endpoint, store);
      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // First request succeeds
      const res1 = await request(app).get('/test');
      expect(res1.status).toBe(200);

      // Second request immediately fails
      const res2 = await request(app).get('/test');
      expect(res2.status).toBe(429);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third request should succeed (new window)
      const res3 = await request(app).get('/test');
      expect(res3.status).toBe(200);

      store.destroy();
    });

    it('should use provided store instance', async () => {
      const app = express();
      const sharedStore = new InMemoryStore();

      const endpoint = {
        path: '/test',
        windowMs: 60000,
        maxRequests: 2,
      };

      const limiter = createEndpointRateLimiter(endpoint, sharedStore);
      app.use('/test', limiter, (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      // Make 2 requests
      await request(app).get('/test');
      await request(app).get('/test');

      // Verify store was used by checking that 3rd request is rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);

      sharedStore.destroy();
    });
  });

  describe('applyRateLimiters', () => {
    it('should apply rate limiters to all configured endpoints', async () => {
      const app = express();

      applyRateLimiters(app, 'production');

      // Mock endpoints after applying rate limiters
      app.post('/api/risk/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ risk: 'low' });
      });

      app.get('/api/credit/lines', (req: Request, res: Response) => {
        res.status(200).json({ lines: [] });
      });

      // Verify rate limiters are applied by checking headers
      const res1 = await request(app).post('/api/risk/evaluate');
      expect(res1.headers['x-ratelimit-limit']).toBe('20');

      const res2 = await request(app).get('/api/credit/lines');
      expect(res2.headers['x-ratelimit-limit']).toBe('100');
    });

    it('should use development config when no environment specified', async () => {
      const app = express();

      applyRateLimiters(app);

      app.post('/api/risk/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ risk: 'low' });
      });

      const res = await request(app).post('/api/risk/evaluate');
      expect(res.headers['x-ratelimit-limit']).toBe('200');
    });

    it('should share store across all endpoints', async () => {
      const app = express();

      applyRateLimiters(app, 'production');

      app.post('/api/risk/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ risk: 'low' });
      });

      app.get('/api/credit/lines', (req: Request, res: Response) => {
        res.status(200).json({ lines: [] });
      });

      // Make requests to both endpoints
      await request(app).post('/api/risk/evaluate');
      await request(app).get('/api/credit/lines');

      // Both should have independent counters (verified by headers)
      const res1 = await request(app).post('/api/risk/evaluate');
      expect(res1.headers['x-ratelimit-remaining']).toBe('18'); // 20 - 2

      const res2 = await request(app).get('/api/credit/lines');
      expect(res2.headers['x-ratelimit-remaining']).toBe('98'); // 100 - 2
    });
  });

  describe('applyRateLimiterToRouter', () => {
    it('should apply rate limiter to specific router', async () => {
      const app = express();
      const router = Router();
      const store = new InMemoryStore();

      const endpoint = {
        path: '/evaluate',
        windowMs: 60000,
        maxRequests: 5,
      };

      applyRateLimiterToRouter(router, endpoint, store);

      router.post('/evaluate', (req: Request, res: Response) => {
        res.status(200).json({ result: 'ok' });
      });

      app.use('/api/risk', router);

      // Make 5 requests - should succeed
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/risk/evaluate');
        expect(res.status).toBe(200);
      }

      // 6th request should be rate limited
      const res = await request(app).post('/api/risk/evaluate');
      expect(res.status).toBe(429);

      store.destroy();
    });

    it('should use provided store instance', async () => {
      const app = express();
      const router = Router();
      const sharedStore = new InMemoryStore();

      const endpoint = {
        path: '/test',
        windowMs: 60000,
        maxRequests: 3,
      };

      applyRateLimiterToRouter(router, endpoint, sharedStore);

      router.get('/test', (req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      app.use(router);

      // Make 3 requests
      await request(app).get('/test');
      await request(app).get('/test');
      await request(app).get('/test');

      // Verify store was used by checking that 4th request is rate limited
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);

      sharedStore.destroy();
    });
  });

  describe('Default Configuration Fallback', () => {
    it('should provide sensible defaults for all environments', () => {
      const environments = ['development', 'staging', 'production'];

      environments.forEach(env => {
        const config = getRateLimitConfig(env);

        expect(config.defaultWindowMs).toBeGreaterThan(0);
        expect(config.defaultMaxRequests).toBeGreaterThan(0);
        expect(config.endpoints).toBeInstanceOf(Array);
        expect(config.endpoints.length).toBeGreaterThan(0);

        config.endpoints.forEach(endpoint => {
          expect(endpoint.path).toBeTruthy();
          expect(endpoint.windowMs).toBeGreaterThan(0);
          expect(endpoint.maxRequests).toBeGreaterThan(0);
        });
      });
    });

    it('should have consistent window duration across all endpoints', () => {
      const config = getRateLimitConfig('production');
      const expectedWindow = 15 * 60 * 1000;

      config.endpoints.forEach(endpoint => {
        expect(endpoint.windowMs).toBe(expectedWindow);
      });
    });
  });
});
