import { IRateLimitStore } from '../middleware/stores/IRateLimitStore.js';
import { Request } from 'express';

/**
 * Configuration options for the rate limiter middleware.
 */
export interface RateLimiterConfig {
  /** Time window duration in milliseconds */
  windowMs: number;
  
  /** Maximum number of requests allowed per window */
  maxRequests: number;
  
  /** Optional custom store implementation (defaults to InMemoryStore) */
  store?: IRateLimitStore;
  
  /** Optional custom key generator function (defaults to IP-based) */
  keyGenerator?: (req: Request) => string;
  
  /** If true, successful requests (status < 400) won't be counted */
  skipSuccessfulRequests?: boolean;
  
  /** If true, failed requests (status >= 400) won't be counted */
  skipFailedRequests?: boolean;
}

/**
 * Represents a single client's rate limit state for a specific endpoint.
 * Stored in the rate limit store with key format: {clientIP}:{endpointPath}
 */
export interface RateLimitEntry {
  /** Current request count in the time window */
  count: number;
  
  /** Timestamp (milliseconds) when the time window resets */
  resetAt: number;
}

/**
 * JSON response body returned when a client exceeds their rate limit (HTTP 429).
 */
export interface RateLimitResponse {
  /** Error message: "Rate limit exceeded" */
  error: string;
  
  /** Number of seconds until the client can retry */
  retryAfter: number;
  
  /** Maximum requests allowed in the time window */
  limit: number;
}

/**
 * Rate limit configuration for a specific API endpoint.
 */
export interface EndpointRateLimit {
  /** API endpoint path (e.g., "/api/risk/evaluate") */
  path: string;
  
  /** Time window duration in milliseconds */
  windowMs: number;
  
  /** Maximum number of requests allowed per window */
  maxRequests: number;
}

/**
 * Complete rate limit configuration for an environment.
 * Includes default values and per-endpoint overrides.
 */
export interface RateLimitConfiguration {
  /** Default time window for endpoints without specific configuration */
  defaultWindowMs: number;
  
  /** Default maximum requests for endpoints without specific configuration */
  defaultMaxRequests: number;
  
  /** Array of endpoint-specific rate limit configurations */
  endpoints: EndpointRateLimit[];
}
