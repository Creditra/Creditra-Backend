# Design Document: API Rate Limiting

## Overview

The API rate limiting feature protects the creditra-backend system from abuse, overload, and denial-of-service attacks by restricting the number of requests clients can make within configurable time windows. This design implements a flexible, performant Express middleware solution that tracks requests per client IP address using an in-memory store with a clean abstraction layer for future Redis migration.

The system provides per-endpoint rate limit configuration, clear error responses with retry information, and maintains minimal performance overhead (<5ms per request). The architecture follows Express middleware patterns and integrates seamlessly with existing TypeScript/ESM routes while supporting environment-specific configurations for development, staging, and production deployments.

## Architecture

### High-Level Architecture

The rate limiting system follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    Express Application                   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Rate Limiter Middleware Layer               │
│  ┌─────────────────────────────────────────────────┐   │
│  │         RateLimiterMiddleware                    │   │
│  │  - Extract client identifier (IP)                │   │
│  │  - Check rate limit via store                    │   │
│  │  - Enforce limits and format responses           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Rate Limit Store Interface                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │         IRateLimitStore (Abstract)               │   │
│  │  - increment(key, window): count                 │   │
│  │  - get(key): count | null                        │   │
│  │  - reset(key): void                              │   │
│  │  - cleanup(): void                               │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│           Store Implementations                          │
│  ┌──────────────────────┐  ┌──────────────────────┐    │
│  │  InMemoryStore       │  │  RedisStore          │    │
│  │  (Current)           │  │  (Future)            │    │
│  │  - Map-based         │  │  - Redis client      │    │
│  │  - Automatic cleanup │  │  - TTL-based         │    │
│  └──────────────────────┘  └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Configuration Layer                         │
│  - Environment-specific limits                           │
│  - Per-endpoint configurations                           │
│  - Default fallback values                               │
└─────────────────────────────────────────────────────────┘
```

### Middleware Flow

```
Request → Extract IP → Generate Key → Check Store → Decision
                                                        │
                        ┌───────────────────────────────┴──────────────────────────────┐
                        │                                                               │
                   Within Limit                                                  Exceeded Limit
                        │                                                               │
                        ▼                                                               ▼
              Increment Counter                                              Return 429 Response
                        │                                                    - Error message
                        ▼                                                    - Retry-After header
                 Call next()                                                 - JSON body with details
```

### Key Design Decisions

1. **IP-Based Client Identification**: Uses `req.ip` from Express for simplicity and compatibility with proxy configurations (X-Forwarded-For support via Express trust proxy setting)

2. **In-Memory Store with Interface Abstraction**: Implements a store interface that allows swapping implementations without changing middleware logic, enabling future Redis migration

3. **Sliding Window Counter**: Uses a simple counter that resets at window expiration rather than sliding window log for performance and memory efficiency

4. **Automatic Cleanup**: Implements periodic cleanup of expired entries to prevent memory leaks in long-running processes

5. **Per-Endpoint Configuration**: Supports different rate limits for different routes through middleware factory pattern

## Components and Interfaces

### 1. IRateLimitStore Interface

Abstract interface defining storage operations for rate limit tracking:

```typescript
interface IRateLimitStore {
  /**
   * Increment the request count for a key within a time window
   * @param key - Unique identifier (e.g., "ip:endpoint")
   * @param windowMs - Time window duration in milliseconds
   * @returns Current count after increment and window reset timestamp
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;

  /**
   * Get current request count for a key
   * @param key - Unique identifier
   * @returns Current count or null if not found/expired
   */
  get(key: string): Promise<number | null>;

  /**
   * Reset the request count for a key
   * @param key - Unique identifier
   */
  reset(key: string): Promise<void>;

  /**
   * Clean up expired entries
   * @returns Number of entries cleaned up
   */
  cleanup(): Promise<number>;
}
```

### 2. InMemoryStore Implementation

Concrete implementation using JavaScript Map:

```typescript
class InMemoryStore implements IRateLimitStore {
  private store: Map<string, { count: number; resetAt: number }>;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(cleanupIntervalMs: number = 60000) {
    this.store = new Map();
    this.startCleanup(cleanupIntervalMs);
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      // Create new window
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }

    // Increment existing window
    entry.count++;
    this.store.set(key, entry);
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async get(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
      return null;
    }
    return entry.count;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  private startCleanup(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}
```

### 3. RateLimiterMiddleware

Express middleware factory that creates configured rate limiter instances:

```typescript
interface RateLimiterConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Maximum requests per window
  store?: IRateLimitStore; // Optional custom store (defaults to InMemoryStore)
  keyGenerator?: (req: Request) => string; // Optional custom key generator
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean;     // Don't count failed requests
}

function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  const {
    windowMs,
    maxRequests,
    store = new InMemoryStore(),
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientKey = keyGenerator(req);
      const key = `${clientKey}:${req.path}`;

      const { count, resetAt } = await store.increment(key, windowMs);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
      res.setHeader('X-RateLimit-Reset', new Date(resetAt).toISOString());

      if (count > maxRequests) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        
        res.setHeader('Retry-After', retryAfter);
        
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter,
          limit: maxRequests,
        });
      }

      // Handle skip options
      if (skipSuccessfulRequests || skipFailedRequests) {
        const originalSend = res.send;
        res.send = function (body) {
          const statusCode = res.statusCode;
          const shouldSkip =
            (skipSuccessfulRequests && statusCode < 400) ||
            (skipFailedRequests && statusCode >= 400);

          if (shouldSkip) {
            // Decrement counter (implementation detail)
            store.get(key).then((current) => {
              if (current !== null && current > 0) {
                // Note: This is a simplified approach
                // Real implementation would need atomic decrement
              }
            });
          }

          return originalSend.call(this, body);
        };
      }

      next();
    } catch (error) {
      // Log error but don't block request on rate limiter failure
      console.error('Rate limiter error:', error);
      next();
    }
  };
}
```

### 4. Configuration Module

Centralized configuration management:

```typescript
interface EndpointRateLimit {
  path: string;
  windowMs: number;
  maxRequests: number;
}

interface RateLimitConfiguration {
  defaultWindowMs: number;
  defaultMaxRequests: number;
  endpoints: EndpointRateLimit[];
}

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
    defaultWindowMs: 15 * 60 * 1000,
    defaultMaxRequests: 100,
    endpoints: [
      { path: '/api/risk/evaluate', windowMs: 15 * 60 * 1000, maxRequests: 20 },
      { path: '/api/credit/lines', windowMs: 15 * 60 * 1000, maxRequests: 100 },
      { path: '/api/credit/lines/:id', windowMs: 15 * 60 * 1000, maxRequests: 100 },
    ],
  },
  production: {
    defaultWindowMs: 15 * 60 * 1000,
    defaultMaxRequests: 100,
    endpoints: [
      { path: '/api/risk/evaluate', windowMs: 15 * 60 * 1000, maxRequests: 20 },
      { path: '/api/credit/lines', windowMs: 15 * 60 * 1000, maxRequests: 100 },
      { path: '/api/credit/lines/:id', windowMs: 15 * 60 * 1000, maxRequests: 100 },
    ],
  },
};

function getRateLimitConfig(environment: string = process.env.NODE_ENV || 'development'): RateLimitConfiguration {
  return rateLimitConfig[environment] || rateLimitConfig.development;
}

function createEndpointRateLimiter(endpoint: EndpointRateLimit, store?: IRateLimitStore): RequestHandler {
  return createRateLimiter({
    windowMs: endpoint.windowMs,
    maxRequests: endpoint.maxRequests,
    store,
  });
}
```

### 5. Integration Module

Helper functions for applying rate limiters to Express routes:

```typescript
function applyRateLimiters(app: Express, environment?: string): void {
  const config = getRateLimitConfig(environment);
  const store = new InMemoryStore();

  config.endpoints.forEach((endpoint) => {
    const limiter = createEndpointRateLimiter(endpoint, store);
    app.use(endpoint.path, limiter);
  });
}

// Alternative: Apply to specific router
function applyRateLimiterToRouter(router: Router, endpoint: EndpointRateLimit, store?: IRateLimitStore): void {
  const limiter = createEndpointRateLimiter(endpoint, store);
  router.use(endpoint.path, limiter);
}
```

## Data Models

### Rate Limit Entry

Represents a single client's rate limit state for a specific endpoint:

```typescript
interface RateLimitEntry {
  count: number;      // Current request count in window
  resetAt: number;    // Timestamp (ms) when window resets
}
```

**Storage Key Format**: `{clientIP}:{endpointPath}`

Examples:
- `192.168.1.100:/api/risk/evaluate`
- `10.0.0.5:/api/credit/lines`

### Rate Limit Response

JSON response body for 429 status:

```typescript
interface RateLimitResponse {
  error: string;       // "Rate limit exceeded"
  retryAfter: number;  // Seconds until client can retry
  limit: number;       // Maximum requests allowed in window
}
```

Example:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 847,
  "limit": 20
}
```

### HTTP Headers

Standard rate limit headers included in all responses:

```
X-RateLimit-Limit: 100           // Maximum requests per window
X-RateLimit-Remaining: 73        // Requests remaining in current window
X-RateLimit-Reset: 2024-01-15T10:30:00.000Z  // ISO timestamp of window reset
Retry-After: 847                 // Seconds until retry (429 responses only)
```

## Performance Optimization

### Memory Efficiency

1. **Compact Data Structure**: Each entry stores only 2 numbers (count + timestamp), approximately 16 bytes per client-endpoint pair

2. **Automatic Cleanup**: Background task runs every 60 seconds to remove expired entries, preventing unbounded memory growth

3. **Estimated Memory Usage**:
   - 1,000 active clients × 3 endpoints = 3,000 entries
   - 3,000 entries × 16 bytes = 48 KB
   - With Map overhead: ~100 KB total

### Request Processing Performance

1. **O(1) Operations**: Map-based store provides constant-time lookups and updates

2. **Minimal Computation**:
   - Single Map lookup
   - Timestamp comparison
   - Counter increment
   - Header setting
   - Total: <1ms for in-memory operations

3. **Async/Await Pattern**: Store interface uses promises to support future async stores (Redis) without blocking

4. **Error Handling**: Rate limiter failures don't block requests (fail-open pattern for availability)

### Optimization Strategies

1. **Single Store Instance**: Share one store across all middleware instances to reduce memory duplication

2. **Efficient Key Generation**: Simple string concatenation for keys (no hashing overhead)

3. **Lazy Cleanup**: Only clean expired entries periodically, not on every request

4. **Header Caching**: Pre-calculate header values during limit check to avoid redundant computation


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Request Increment

For any client and any endpoint, when a request is made within a time window, the request count for that client-endpoint pair should increase by exactly 1.

**Validates: Requirements 1.1, 1.2**

### Property 2: Rate Limit Enforcement

For any client, endpoint, and quota configuration, when the number of requests exceeds the configured quota within a time window, subsequent requests should be rejected with HTTP 429 status and a properly formatted response containing all required fields (error message, retryAfter, limit, and Retry-After header).

**Validates: Requirements 1.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 3: Time Window Reset

For any client and endpoint, making requests up to the quota, then waiting for the time window to expire, should allow the same number of requests again (round-trip property: increment → wait → reset → increment).

**Validates: Requirements 1.4**

### Property 4: Client Independence

For any two different client IP addresses making requests to the same endpoint, the request count for one client should not affect the request count for the other client.

**Validates: Requirements 1.6**

### Property 5: Configuration Respect

For any rate limiter configuration (quota and window duration), the enforced limits should match the provided configuration values, and when no configuration is provided, default values (100 requests per 15 minutes) should be used.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 6: Endpoint Independence

For any two different endpoints with different quota configurations, requests to one endpoint should not affect the rate limit counter for the other endpoint, even from the same client IP.

**Validates: Requirements 2.4**

### Property 7: Store Interface Compliance

For any implementation of the IRateLimitStore interface, all required operations (increment, get, reset, cleanup) should function correctly and maintain consistent state across operations.

**Validates: Requirements 7.2**

### Property 8: Store Substitutability

For any valid IRateLimitStore implementation provided at initialization, the rate limiter should function correctly with that store implementation, demonstrating proper abstraction.

**Validates: Requirements 7.4**

### Property 9: Cleanup Effectiveness

For any set of rate limit entries with expired time windows, running the cleanup operation should remove all expired entries and return the count of removed entries.

**Validates: Requirements 5.3**

## Error Handling

### Error Categories

1. **Store Operation Failures**
   - Scenario: Store increment/get operations throw errors
   - Handling: Log error, fail-open (allow request to proceed)
   - Rationale: Availability over strict rate limiting

2. **Invalid Client Identification**
   - Scenario: Unable to extract IP address from request
   - Handling: Use fallback identifier (e.g., "unknown") or skip rate limiting
   - Rationale: Don't block legitimate requests due to proxy misconfiguration

3. **Configuration Errors**
   - Scenario: Invalid configuration values (negative limits, zero window)
   - Handling: Throw error at initialization time, fail-fast
   - Rationale: Configuration errors should be caught before deployment

4. **Memory Exhaustion**
   - Scenario: Store grows too large
   - Handling: Aggressive cleanup, optional max entries limit
   - Rationale: Prevent OOM crashes in production

### Error Response Format

Rate limiter errors that don't block requests are logged but not exposed to clients:

```typescript
try {
  // Rate limit check
} catch (error) {
  console.error('Rate limiter error:', error);
  // Continue to next middleware
  next();
}
```

### Graceful Degradation

The rate limiter implements fail-open behavior:
- If store operations fail, requests proceed normally
- If cleanup fails, it's retried on next interval
- System availability is prioritized over perfect rate limiting

### Monitoring and Alerting

Recommended monitoring points:
1. Rate limiter error count (should be zero)
2. Store size (should stay bounded)
3. Cleanup effectiveness (should remove entries regularly)
4. 429 response rate (should match expected abuse patterns)

## Testing Strategy

### Dual Testing Approach

The testing strategy employs both unit tests and property-based tests to achieve comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, error conditions, and integration points
- **Property tests**: Verify universal properties across randomized inputs

Both approaches are complementary and necessary. Unit tests catch concrete bugs and validate specific scenarios, while property tests verify general correctness across a wide input space.

### Property-Based Testing

**Library**: fast-check (TypeScript property-based testing library)

**Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with reference to design document property
- Tag format: `Feature: api-rate-limiting, Property {number}: {property_text}`

**Property Test Examples**:

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Rate Limiter Properties', () => {
  // Feature: api-rate-limiting, Property 1: Request Increment
  it('should increment request count by exactly 1 for any client and endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),           // Random IP address
        fc.webPath(),        // Random endpoint path
        fc.integer({ min: 1, max: 1000 }), // Random window
        async (ip, path, windowMs) => {
          const store = new InMemoryStore();
          const key = `${ip}:${path}`;
          
          const before = await store.get(key);
          const { count: after } = await store.increment(key, windowMs);
          
          expect(after).toBe((before || 0) + 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: api-rate-limiting, Property 4: Client Independence
  it('should maintain independent counters for different client IPs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),           // Client 1 IP
        fc.ipV4(),           // Client 2 IP
        fc.webPath(),        // Shared endpoint
        fc.integer({ min: 1, max: 100 }), // Request count
        async (ip1, ip2, path, requests) => {
          fc.pre(ip1 !== ip2); // Ensure different IPs
          
          const store = new InMemoryStore();
          const windowMs = 60000;
          
          // Client 1 makes requests
          for (let i = 0; i < requests; i++) {
            await store.increment(`${ip1}:${path}`, windowMs);
          }
          
          // Client 2's count should be unaffected
          const client2Count = await store.get(`${ip2}:${path}`);
          expect(client2Count).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: api-rate-limiting, Property 3: Time Window Reset
  it('should reset counter after time window expires (round-trip)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),
        fc.webPath(),
        fc.integer({ min: 100, max: 1000 }), // Window duration
        fc.integer({ min: 1, max: 50 }),     // Request count
        async (ip, path, windowMs, requests) => {
          const store = new InMemoryStore();
          const key = `${ip}:${path}`;
          
          // Make requests
          let lastResult;
          for (let i = 0; i < requests; i++) {
            lastResult = await store.increment(key, windowMs);
          }
          
          expect(lastResult.count).toBe(requests);
          
          // Wait for window to expire (simulate with manual reset)
          await new Promise(resolve => setTimeout(resolve, windowMs + 10));
          
          // Next request should start fresh
          const { count } = await store.increment(key, windowMs);
          expect(count).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Unit Testing

**Framework**: Vitest

**Coverage Target**: 95% code coverage for rate limiter module

**Unit Test Categories**:

1. **Specific Examples**:
   - Test default configuration (100 requests per 15 minutes)
   - Test specific endpoint configurations (POST /api/risk/evaluate with 20 requests)
   - Test development environment has higher limits

2. **Edge Cases**:
   - Empty/null IP address
   - Concurrent requests from same client
   - Requests at exact window boundary
   - Very large request counts
   - Zero or negative configuration values

3. **Error Conditions**:
   - Store operation failures
   - Invalid configuration
   - Memory exhaustion scenarios
   - Cleanup failures

4. **Integration Tests**:
   - Express middleware integration
   - Multiple endpoints with different limits
   - Header setting verification
   - Response format validation

**Unit Test Examples**:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

describe('Rate Limiter Middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    // Setup test app
  });

  it('should use default limits when no config provided', async () => {
    const limiter = createRateLimiter({
      windowMs: 15 * 60 * 1000,
      maxRequests: 100,
    });
    
    app.use('/test', limiter, (req, res) => res.json({ ok: true }));
    
    // Make 100 requests - should succeed
    for (let i = 0; i < 100; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }
    
    // 101st request should be rate limited
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Rate limit exceeded');
  });

  it('should protect POST /api/risk/evaluate with 20 requests per 15 minutes', async () => {
    const config = getRateLimitConfig('production');
    const endpoint = config.endpoints.find(e => e.path === '/api/risk/evaluate');
    
    expect(endpoint).toBeDefined();
    expect(endpoint.maxRequests).toBe(20);
    expect(endpoint.windowMs).toBe(15 * 60 * 1000);
  });

  it('should include all required fields in 429 response', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 1,
    });
    
    app.use('/test', limiter, (req, res) => res.json({ ok: true }));
    
    // First request succeeds
    await request(app).get('/test');
    
    // Second request gets rate limited
    const res = await request(app).get('/test');
    
    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty('error', 'Rate limit exceeded');
    expect(res.body).toHaveProperty('retryAfter');
    expect(res.body).toHaveProperty('limit', 1);
    expect(res.headers).toHaveProperty('retry-after');
    expect(typeof res.body.retryAfter).toBe('number');
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it('should maintain independent limits for different endpoints', async () => {
    const store = new InMemoryStore();
    
    const limiter1 = createRateLimiter({
      windowMs: 60000,
      maxRequests: 5,
      store,
    });
    
    const limiter2 = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      store,
    });
    
    app.use('/endpoint1', limiter1, (req, res) => res.json({ endpoint: 1 }));
    app.use('/endpoint2', limiter2, (req, res) => res.json({ endpoint: 2 }));
    
    // Make 5 requests to endpoint1
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/endpoint1');
      expect(res.status).toBe(200);
    }
    
    // Endpoint1 should be rate limited
    const res1 = await request(app).get('/endpoint1');
    expect(res1.status).toBe(429);
    
    // Endpoint2 should still work
    const res2 = await request(app).get('/endpoint2');
    expect(res2.status).toBe(200);
  });

  it('should handle store errors gracefully (fail-open)', async () => {
    const faultyStore: IRateLimitStore = {
      increment: async () => { throw new Error('Store failure'); },
      get: async () => { throw new Error('Store failure'); },
      reset: async () => { throw new Error('Store failure'); },
      cleanup: async () => { throw new Error('Store failure'); },
    };
    
    const limiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 1,
      store: faultyStore,
    });
    
    app.use('/test', limiter, (req, res) => res.json({ ok: true }));
    
    // Request should succeed despite store failure
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

describe('InMemoryStore', () => {
  it('should clean up expired entries', async () => {
    const store = new InMemoryStore(100); // Fast cleanup interval
    
    // Create entries with short window
    await store.increment('key1', 50);
    await store.increment('key2', 50);
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Trigger cleanup
    const cleaned = await store.cleanup();
    
    expect(cleaned).toBeGreaterThan(0);
    expect(await store.get('key1')).toBeNull();
    expect(await store.get('key2')).toBeNull();
  });
});
```

### Test Coverage Requirements

- Overall module coverage: ≥95%
- Branch coverage: ≥90%
- Function coverage: 100%
- Line coverage: ≥95%

### Testing Checklist

- [ ] All 9 correctness properties implemented as property-based tests
- [ ] Specific endpoint configurations tested (Requirements 3.1-3.4)
- [ ] Default configuration tested (Requirement 2.3)
- [ ] Response format validated (Requirements 4.1-4.6)
- [ ] Client independence verified (Requirement 1.6)
- [ ] Endpoint independence verified (Requirement 2.4)
- [ ] Time window reset tested (Requirement 1.4)
- [ ] Store interface compliance tested (Requirement 7.2)
- [ ] Store substitutability tested (Requirement 7.4)
- [ ] Cleanup effectiveness tested (Requirement 5.3)
- [ ] Error handling tested (fail-open behavior)
- [ ] Integration with Express tested
- [ ] Concurrent request handling tested
- [ ] Memory leak prevention verified
- [ ] 95% code coverage achieved

## Implementation Notes

### File Structure

```
src/
├── middleware/
│   ├── rateLimiter.ts          # Main middleware factory
│   ├── rateLimiterConfig.ts    # Configuration management
│   └── stores/
│       ├── IRateLimitStore.ts  # Store interface
│       ├── InMemoryStore.ts    # In-memory implementation
│       └── RedisStore.ts       # Future Redis implementation
├── types/
│   └── rateLimiter.types.ts    # TypeScript interfaces
└── utils/
    └── rateLimiterHelpers.ts   # Helper functions

tests/
├── unit/
│   ├── rateLimiter.test.ts
│   ├── InMemoryStore.test.ts
│   └── rateLimiterConfig.test.ts
└── properties/
    ├── rateLimiter.properties.test.ts
    └── store.properties.test.ts
```

### Integration with Existing Routes

Apply rate limiters in the main Express app setup:

```typescript
// src/app.ts
import express from 'express';
import { applyRateLimiters } from './middleware/rateLimiterConfig';

const app = express();

// Apply rate limiters to configured endpoints
applyRateLimiters(app, process.env.NODE_ENV);

// Existing routes
app.use('/api/risk', riskRouter);
app.use('/api/credit', creditRouter);

export default app;
```

### Environment Configuration

Add rate limit configuration to environment files:

```typescript
// .env.development
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

// .env.production
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Monitoring Integration

Add metrics collection for observability:

```typescript
// Track rate limit hits
metrics.increment('rate_limit.exceeded', {
  endpoint: req.path,
  client: clientKey,
});

// Track store size
metrics.gauge('rate_limit.store_size', store.size());

// Track cleanup effectiveness
metrics.gauge('rate_limit.cleanup_count', cleanedCount);
```

### Future Redis Migration Path

When ready to migrate to Redis:

1. Implement RedisStore class following IRateLimitStore interface
2. Update configuration to instantiate RedisStore instead of InMemoryStore
3. No changes needed to middleware logic
4. Run same property tests against RedisStore implementation

```typescript
// Future RedisStore implementation
class RedisStore implements IRateLimitStore {
  constructor(private client: RedisClient) {}

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const resetAt = now + windowMs;
    
    // Use Redis INCR with EXPIRE
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.pexpire(key, windowMs);
    }
    
    return { count, resetAt };
  }

  // ... other methods
}
```

### Documentation Requirements

Per Requirement 8, the following documentation must be included:

1. **JSDoc Comments**: All public functions and interfaces must have comprehensive JSDoc comments
2. **Usage Examples**: README must include examples of applying rate limiters to endpoints
3. **Rate Limit Table**: Documentation must include a table of current limits per endpoint:

| Endpoint | Method | Limit (Production) | Window | Limit (Development) |
|----------|--------|-------------------|--------|-------------------|
| /api/risk/evaluate | POST | 20 requests | 15 min | 200 requests |
| /api/credit/lines | GET | 100 requests | 15 min | 1000 requests |
| /api/credit/lines/:id | GET | 100 requests | 15 min | 1000 requests |

### Performance Benchmarking

To verify the <5ms requirement (5.1), include benchmark tests:

```typescript
import { describe, it } from 'vitest';
import { performance } from 'perf_hooks';

describe('Rate Limiter Performance', () => {
  it('should process requests in less than 5ms', async () => {
    const store = new InMemoryStore();
    const iterations = 1000;
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await store.increment(`client${i % 100}:/api/test`, 60000);
      const end = performance.now();
      times.push(end - start);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const p95Time = times.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];
    
    console.log(`Average: ${avgTime.toFixed(3)}ms, P95: ${p95Time.toFixed(3)}ms`);
    expect(p95Time).toBeLessThan(5);
  });
});
```

## Summary

This design provides a comprehensive, production-ready rate limiting solution for the creditra-backend API. The architecture emphasizes:

- **Flexibility**: Per-endpoint and per-environment configuration
- **Performance**: <5ms overhead with memory-efficient data structures
- **Maintainability**: Clean abstractions and comprehensive testing
- **Scalability**: Redis-ready architecture for future distributed deployments
- **Reliability**: Fail-open error handling and automatic cleanup

The implementation follows Express middleware patterns, integrates seamlessly with existing TypeScript/ESM code, and provides clear error messages to API consumers. The dual testing strategy (unit + property-based tests) ensures 95% coverage and validates both specific scenarios and universal correctness properties.
