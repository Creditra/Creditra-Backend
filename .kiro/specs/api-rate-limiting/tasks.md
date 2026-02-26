# Implementation Plan: API Rate Limiting

## Overview

This plan implements a flexible, performant Express middleware for rate limiting that protects the creditra-backend API from abuse and overload. The implementation uses TypeScript with an in-memory store and clean abstractions for future Redis migration. The system provides per-endpoint configuration, maintains <5ms overhead, and includes comprehensive property-based and unit testing targeting 95% coverage.

## Tasks

- [x] 1. Set up project structure and core interfaces
  - Create directory structure: `src/middleware/stores/`, `src/types/`, `tests/unit/`, `tests/properties/`
  - Define `IRateLimitStore` interface in `src/middleware/stores/IRateLimitStore.ts`
  - Define TypeScript types in `src/types/rateLimiter.types.ts` (RateLimiterConfig, RateLimitEntry, RateLimitResponse, EndpointRateLimit, RateLimitConfiguration)
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 2. Implement InMemoryStore
  - [x] 2.1 Create InMemoryStore class implementing IRateLimitStore
    - Implement `increment()` method with window expiration logic
    - Implement `get()` method with expiration check
    - Implement `reset()` method
    - Implement `cleanup()` method with automatic interval-based cleanup
    - Add `destroy()` method for cleanup interval teardown
    - Use Map<string, { count: number; resetAt: number }> for storage
    - File: `src/middleware/stores/InMemoryStore.ts`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 5.2, 5.3_

  - [ ]* 2.2 Write property test for InMemoryStore increment
    - **Property 1: Request Increment**
    - **Validates: Requirements 1.1, 1.2**
    - Verify count increases by exactly 1 for any client/endpoint/window combination
    - Use fast-check with fc.ipV4(), fc.webPath(), fc.integer() generators
    - File: `tests/properties/store.properties.test.ts`

  - [ ]* 2.3 Write property test for time window reset
    - **Property 3: Time Window Reset**
    - **Validates: Requirements 1.4**
    - Verify counter resets after window expiration (round-trip property)
    - Test: increment → wait → increment should start fresh
    - File: `tests/properties/store.properties.test.ts`

  - [ ]* 2.4 Write property test for cleanup effectiveness
    - **Property 9: Cleanup Effectiveness**
    - **Validates: Requirements 5.3**
    - Verify cleanup removes all expired entries and returns correct count
    - Generate random expired entries and verify removal
    - File: `tests/properties/store.properties.test.ts`

  - [x]* 2.5 Write unit tests for InMemoryStore
    - Test specific examples: single increment, multiple increments, window expiration
    - Test edge cases: concurrent increments, cleanup at boundaries, very large counts
    - Test error conditions: invalid keys, negative windows
    - Test cleanup interval and destroy method
    - File: `tests/unit/InMemoryStore.test.ts`

- [ ] 3. Implement rate limiter middleware
  - [x] 3.1 Create rate limiter middleware factory
    - Implement `createRateLimiter(config)` function
    - Extract client IP using `req.ip`
    - Generate storage key: `{clientIP}:{req.path}`
    - Call store.increment() and check against maxRequests
    - Set rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
    - Return 429 response with JSON body when limit exceeded
    - Include Retry-After header in 429 responses
    - Implement fail-open error handling (log errors, allow requests)
    - File: `src/middleware/rateLimiter.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1_

  - [ ]* 3.2 Write property test for rate limit enforcement
    - **Property 2: Rate Limit Enforcement**
    - **Validates: Requirements 1.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
    - Verify requests exceeding quota return 429 with all required fields
    - Test with random quotas, windows, and request counts
    - Verify error message, retryAfter, limit, and Retry-After header
    - File: `tests/properties/rateLimiter.properties.test.ts`

  - [ ]* 3.3 Write property test for client independence
    - **Property 4: Client Independence**
    - **Validates: Requirements 1.6**
    - Verify different client IPs have independent counters
    - Generate two different IPs, make requests from one, verify other unaffected
    - File: `tests/properties/rateLimiter.properties.test.ts`

  - [ ]* 3.4 Write unit tests for rate limiter middleware
    - Test requests within quota succeed
    - Test requests exceeding quota return 429
    - Test 429 response format includes all required fields
    - Test rate limit headers are set correctly
    - Test fail-open behavior on store errors
    - Test IP extraction and key generation
    - Use supertest for Express integration testing
    - File: `tests/unit/rateLimiter.test.ts`

- [ ] 4. Implement configuration module
  - [x] 4.1 Create rate limit configuration
    - Define configuration objects for development, staging, production environments
    - Development: 200 req/15min for /api/risk/evaluate, 1000 req/15min for /api/credit/lines
    - Staging/Production: 20 req/15min for /api/risk/evaluate, 100 req/15min for /api/credit/lines
    - Implement `getRateLimitConfig(environment)` function with fallback to development
    - Implement `createEndpointRateLimiter(endpoint, store)` helper
    - File: `src/middleware/rateLimiterConfig.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [ ]* 4.2 Write property test for configuration respect
    - **Property 5: Configuration Respect**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Verify enforced limits match provided configuration
    - Verify default values (100 req/15min) when no config provided
    - Test with random quota and window values
    - File: `tests/properties/rateLimiter.properties.test.ts`

  - [ ]* 4.3 Write unit tests for configuration module
    - Test getRateLimitConfig returns correct config for each environment
    - Test default configuration fallback
    - Test specific endpoint configurations match requirements
    - Test POST /api/risk/evaluate has 20 req limit in production
    - Test GET /api/credit/lines has 100 req limit in production
    - Test development environment has higher limits
    - File: `tests/unit/rateLimiterConfig.test.ts`

- [ ] 5. Implement integration helpers and wire to Express
  - [x] 5.1 Create integration helper functions
    - Implement `applyRateLimiters(app, environment)` function
    - Create shared InMemoryStore instance
    - Apply rate limiters to all configured endpoints
    - Add helper function `applyRateLimiterToRouter(router, endpoint, store)`
    - File: `src/middleware/rateLimiterConfig.ts`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.2 Integrate rate limiters with Express app
    - Import `applyRateLimiters` in main app file (src/app.ts or src/index.ts)
    - Call `applyRateLimiters(app, process.env.NODE_ENV)` before route definitions
    - Ensure rate limiters are applied to /api/risk/evaluate and /api/credit/lines routes
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 5.3 Write property test for endpoint independence
    - **Property 6: Endpoint Independence**
    - **Validates: Requirements 2.4**
    - Verify requests to one endpoint don't affect another endpoint's counter
    - Test with same client IP, different endpoints, different quotas
    - File: `tests/properties/rateLimiter.properties.test.ts`

  - [ ]* 5.4 Write integration tests for multiple endpoints
    - Test rate limiting on /api/risk/evaluate with 20 request limit
    - Test rate limiting on /api/credit/lines with 100 request limit
    - Test independent counters for different endpoints from same client
    - Test shared store across multiple middleware instances
    - Use supertest to make actual HTTP requests
    - File: `tests/unit/rateLimiter.integration.test.ts`

- [ ] 6. Checkpoint - Ensure all tests pass
  - Run all unit tests and property tests
  - Verify 95% code coverage achieved
  - Ensure all tests pass, ask the user if questions arise

- [ ] 7. Implement store interface compliance tests
  - [ ]* 7.1 Write property test for store interface compliance
    - **Property 7: Store Interface Compliance**
    - **Validates: Requirements 7.2**
    - Verify all IRateLimitStore operations maintain consistent state
    - Test increment → get returns same count
    - Test reset → get returns null
    - Test cleanup removes expired entries
    - File: `tests/properties/store.properties.test.ts`

  - [ ]* 7.2 Write property test for store substitutability
    - **Property 8: Store Substitutability**
    - **Validates: Requirements 7.4**
    - Create mock store implementation of IRateLimitStore
    - Verify rate limiter works correctly with custom store
    - Test that middleware doesn't depend on InMemoryStore specifics
    - File: `tests/properties/rateLimiter.properties.test.ts`

- [ ] 8. Add documentation
  - [ ] 8.1 Add JSDoc comments to all public interfaces and functions
    - Document IRateLimitStore interface methods with @param and @returns
    - Document RateLimiterConfig interface properties
    - Document createRateLimiter function with usage examples
    - Document configuration functions
    - _Requirements: 8.1, 8.2_

  - [ ] 8.2 Create README documentation
    - Add "Rate Limiting" section to project README
    - Include usage examples for applying rate limiters to endpoints
    - Include table of current rate limits per endpoint (production and development)
    - Document configuration options and environment variables
    - Include example of custom store implementation for future Redis migration
    - _Requirements: 8.3, 8.4_

  - [ ] 8.3 Add inline code comments
    - Comment complex logic in InMemoryStore (window expiration, cleanup)
    - Comment middleware flow in createRateLimiter
    - Comment fail-open error handling rationale
    - Document key generation format

- [ ] 9. Performance validation and optimization
  - [ ]* 9.1 Write performance benchmark tests
    - Verify <5ms processing time per request (P95)
    - Test with 1000 iterations, measure average and P95 latency
    - Test store operations: increment, get, cleanup
    - Test middleware end-to-end with Express
    - File: `tests/unit/rateLimiter.performance.test.ts`
    - _Requirements: 5.1_

  - [ ]* 9.2 Write memory efficiency tests
    - Verify cleanup prevents memory leaks
    - Test store size remains bounded over time
    - Verify expired entries are removed
    - Test with long-running simulation (many windows)
    - _Requirements: 5.2, 5.3_

- [ ] 10. Final checkpoint - Verify all requirements met
  - Run full test suite (unit + property tests)
  - Verify 95% code coverage achieved
  - Test rate limiting on actual endpoints with curl/Postman
  - Verify 429 responses include all required fields
  - Verify rate limit headers are present in all responses
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All property tests use fast-check library with minimum 100 iterations
- Each property test is tagged with property number and validated requirements
- Unit tests use Vitest framework with supertest for Express integration
- Target: 95% code coverage for rate limiter module
- Performance requirement: <5ms per request (P95)
- Error handling: fail-open pattern (availability over strict limiting)
- Store abstraction enables future Redis migration without middleware changes
