import { RequestHandler, Express, Router } from 'express';
import { RateLimitConfiguration, EndpointRateLimit } from '../types/rateLimiter.types.js';
import { IRateLimitStore } from './stores/IRateLimitStore.js';
import { InMemoryStore } from './stores/InMemoryStore.js';
import { createRateLimiter } from './rateLimiter.js';

/**
 * Rate limit configurations for different environments.
 * 
 * Development environment uses higher limits to facilitate testing:
 * - /api/risk/evaluate: 200 requests per 15 minutes
 * - /api/credit/lines: 1000 requests per 15 minutes
 * - /api/credit/lines/:id: 1000 requests per 15 minutes
 * 
 * Staging and Production environments use stricter limits:
 * - /api/risk/evaluate: 20 requests per 15 minutes
 * - /api/credit/lines: 100 requests per 15 minutes
 * - /api/credit/lines/:id: 100 requests per 15 minutes
 */
const rateLimitConfig: Record<string, RateLimitConfiguration> = {
  development: {
    defaultWindowMs: 15 * 60 * 1000, // 15 minutes
    defaultMaxRequests: 1000,
    endpoints: [
      { path: '/api/risk/evaluate', windowMs: 15 * 60 * 1000, maxRequests: 200 },
      { path: '/api/credit/lines', windowMs: 15 * 60 * 1000, maxRequests: 1000 },
      { path: '/api/credit/lines/:id', windowMs: 15 * 60 * 1000, maxRequests: 1000 },
    ],
  },
  staging: {
    defaultWindowMs: 15 * 60 * 1000, // 15 minutes
    defaultMaxRequests: 100,
    endpoints: [
      { path: '/api/risk/evaluate', windowMs: 15 * 60 * 1000, maxRequests: 20 },
      { path: '/api/credit/lines', windowMs: 15 * 60 * 1000, maxRequests: 100 },
      { path: '/api/credit/lines/:id', windowMs: 15 * 60 * 1000, maxRequests: 100 },
    ],
  },
  production: {
    defaultWindowMs: 15 * 60 * 1000, // 15 minutes
    defaultMaxRequests: 100,
    endpoints: [
      { path: '/api/risk/evaluate', windowMs: 15 * 60 * 1000, maxRequests: 20 },
      { path: '/api/credit/lines', windowMs: 15 * 60 * 1000, maxRequests: 100 },
      { path: '/api/credit/lines/:id', windowMs: 15 * 60 * 1000, maxRequests: 100 },
    ],
  },
};

/**
 * Retrieves the rate limit configuration for a specific environment.
 * 
 * @param environment - Environment name (development, staging, production).
 *                      Defaults to NODE_ENV or 'development' if not specified.
 * @returns Rate limit configuration for the environment, or development config as fallback
 * 
 * @example
 * ```typescript
 * const config = getRateLimitConfig('production');
 * console.log(config.endpoints); // Production endpoint configurations
 * ```
 */
export function getRateLimitConfig(environment: string = process.env.NODE_ENV || 'development'): RateLimitConfiguration {
  return rateLimitConfig[environment] || rateLimitConfig.development;
}

/**
 * Creates a rate limiter middleware for a specific endpoint configuration.
 * 
 * This helper function wraps createRateLimiter with endpoint-specific settings,
 * making it easy to apply consistent rate limiting across the application.
 * 
 * @param endpoint - Endpoint rate limit configuration
 * @param store - Optional custom store implementation (defaults to InMemoryStore)
 * @returns Express middleware function configured for the endpoint
 * 
 * @example
 * ```typescript
 * const config = getRateLimitConfig('production');
 * const riskEndpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
 * const limiter = createEndpointRateLimiter(riskEndpoint, sharedStore);
 * app.use('/api/risk/evaluate', limiter);
 * ```
 */
export function createEndpointRateLimiter(endpoint: EndpointRateLimit, store?: IRateLimitStore): RequestHandler {
  return createRateLimiter({
    windowMs: endpoint.windowMs,
    maxRequests: endpoint.maxRequests,
    store,
  });
}

/**
 * Applies rate limiters to all configured endpoints in an Express application.
 * 
 * This function creates a single shared InMemoryStore instance and applies
 * rate limiting middleware to all endpoints defined in the environment configuration.
 * The shared store ensures consistent rate limiting across all endpoints.
 * 
 * @param app - Express application instance
 * @param environment - Environment name (development, staging, production).
 *                      Defaults to NODE_ENV or 'development' if not specified.
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { applyRateLimiters } from './middleware/rateLimiterConfig';
 * 
 * const app = express();
 * app.use(express.json());
 * 
 * // Apply rate limiters before route definitions
 * applyRateLimiters(app, process.env.NODE_ENV);
 * 
 * // Define routes
 * app.use('/api/credit', creditRouter);
 * app.use('/api/risk', riskRouter);
 * ```
 */
export function applyRateLimiters(app: Express, environment?: string): void {
  const config = getRateLimitConfig(environment);
  const store = new InMemoryStore();

  config.endpoints.forEach((endpoint) => {
    const limiter = createEndpointRateLimiter(endpoint, store);
    app.use(endpoint.path, limiter);
  });
}

/**
 * Applies a rate limiter to a specific Express router.
 * 
 * This helper function allows applying rate limiting to individual routers
 * rather than the entire application. Useful for modular route organization.
 * 
 * @param router - Express router instance
 * @param endpoint - Endpoint rate limit configuration
 * @param store - Optional custom store implementation (defaults to InMemoryStore)
 * 
 * @example
 * ```typescript
 * import { Router } from 'express';
 * import { applyRateLimiterToRouter } from './middleware/rateLimiterConfig';
 * 
 * const router = Router();
 * const store = new InMemoryStore();
 * 
 * applyRateLimiterToRouter(router, {
 *   path: '/evaluate',
 *   windowMs: 15 * 60 * 1000,
 *   maxRequests: 20
 * }, store);
 * 
 * router.post('/evaluate', evaluateHandler);
 * ```
 */
export function applyRateLimiterToRouter(
  router: Router,
  endpoint: EndpointRateLimit,
  store?: IRateLimitStore
): void {
  const limiter = createEndpointRateLimiter(endpoint, store);
  router.use(endpoint.path, limiter);
}
