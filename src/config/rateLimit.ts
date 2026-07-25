/**
 * Rate Limiting Configuration (token bucket)
 *
 * Configurable per-route defaults loaded from environment variables.
 * Invalid numeric values fall back to the documented defaults.
 *
 * Env vars:
 *   RATE_LIMIT_WINDOW_MS          - Refill window in ms (default: 60000).
 *                                   Capacity fully refills over this period.
 *   RATE_LIMIT_MAX_REQUESTS       - Bucket capacity for general routes (default: 100)
 *   RATE_LIMIT_MAX_EVALUATE       - Bucket capacity for /api/risk/evaluate (default: 10)
 *   RATE_LIMIT_REDIS_URL          - Optional Redis URL for shared rate-limit storage
 *   RATE_LIMIT_REDIS_FAILURE_MODE - "open" or "closed" on Redis outage (default: open)
 *
 * Admin / service bypass is controlled by ADMIN_API_KEY + X-Admin-Api-Key
 * (see createAdminBypassChecker in middleware/rateLimit.ts); it is not an
 * env knob on the rate-limit config itself.
 */

import type { RedisRateLimitFailureMode } from "../middleware/rateLimit.js";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitConfigs {
  default: RateLimitConfig;
  evaluate: RateLimitConfig;
}

export interface RateLimitStoreConfig {
  redisUrl?: string;
  redisFailureMode: RedisRateLimitFailureMode;
}

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function parseFailureMode(value: string | undefined): RedisRateLimitFailureMode {
  return value === "closed" ? "closed" : "open";
}

export function loadRateLimitConfig(): RateLimitConfigs {
  const windowMs = parseIntOrDefault(
    process.env.RATE_LIMIT_WINDOW_MS,
    60_000,
  );
  const maxRequests = parseIntOrDefault(
    process.env.RATE_LIMIT_MAX_REQUESTS,
    100,
  );
  const maxEvaluate = parseIntOrDefault(
    process.env.RATE_LIMIT_MAX_EVALUATE,
    10,
  );

  return {
    default: { windowMs, maxRequests },
    evaluate: { windowMs, maxRequests: maxEvaluate },
  };
}

export function loadRateLimitStoreConfig(): RateLimitStoreConfig {
  return {
    redisUrl: process.env.RATE_LIMIT_REDIS_URL,
    redisFailureMode: parseFailureMode(process.env.RATE_LIMIT_REDIS_FAILURE_MODE),
  };
}
