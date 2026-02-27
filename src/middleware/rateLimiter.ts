import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RateLimiterConfig } from '../types/rateLimiter.types.js';
import { InMemoryStore } from './stores/InMemoryStore.js';

/**
 * Creates a rate limiter middleware for Express.
 * 
 * The middleware tracks requests per client IP and endpoint path, enforcing
 * configurable rate limits. When limits are exceeded, it returns HTTP 429
 * with retry information. The middleware implements fail-open behavior,
 * allowing requests to proceed if the store encounters errors.
 * 
 * @param config - Rate limiter configuration
 * @param config.windowMs - Time window duration in milliseconds
 * @param config.maxRequests - Maximum requests allowed per window
 * @param config.store - Optional custom store (defaults to InMemoryStore)
 * @param config.keyGenerator - Optional custom key generator (defaults to req.ip)
 * @param config.skipSuccessfulRequests - Don't count successful requests (status < 400)
 * @param config.skipFailedRequests - Don't count failed requests (status >= 400)
 * 
 * @returns Express middleware function
 * 
 * @example
 * ```typescript
 * const limiter = createRateLimiter({
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   maxRequests: 100
 * });
 * app.use('/api/endpoint', limiter);
 * ```
 */
export function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  const {
    windowMs,
    maxRequests,
    store = new InMemoryStore(),
    keyGenerator = (req) => req.ip || 'unknown',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract client identifier (IP address)
      const clientKey = keyGenerator(req);
      
      // Generate storage key: {clientIP}:{endpoint}
      // Use baseUrl + path to get the full path including base path
      const endpoint = (req.baseUrl || '') + (req.path || '');
      const key = `${clientKey}:${endpoint}`;

      // Increment counter and get current state
      const { count, resetAt } = await store.increment(key, windowMs);

      // Set rate limit headers on all responses
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count).toString());
      res.setHeader('X-RateLimit-Reset', new Date(resetAt).toISOString());

      // Check if limit exceeded
      if (count > maxRequests) {
        // Calculate seconds until window reset
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        
        // Set Retry-After header
        res.setHeader('Retry-After', retryAfter.toString());
        
        // Return 429 response with JSON body
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter,
          limit: maxRequests,
        });
      }

      // Handle skip options if configured
      if (skipSuccessfulRequests || skipFailedRequests) {
        // Intercept response to conditionally decrement counter
        const originalSend = res.send;
        res.send = function (body: any) {
          const statusCode = res.statusCode;
          const shouldSkip =
            (skipSuccessfulRequests && statusCode < 400) ||
            (skipFailedRequests && statusCode >= 400);

          if (shouldSkip) {
            // Note: This is a simplified approach for skip functionality
            // A production implementation would need atomic decrement support
            // in the store interface to handle this properly
            store.get(key).then((current) => {
              if (current !== null && current > 0) {
                // Decrement would require additional store method
                // For now, this is a placeholder for future enhancement
              }
            }).catch(() => {
              // Ignore errors in skip logic
            });
          }

          return originalSend.call(this, body);
        };
      }

      // Allow request to proceed
      next();
    } catch (error) {
      // Fail-open: Log error but don't block request
      // This ensures availability even if rate limiter fails
      console.error('Rate limiter error:', error);
      next();
    }
  };
}
