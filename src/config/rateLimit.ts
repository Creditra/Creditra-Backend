/**
 * Rate Limiting Configuration
 *
 * Configurable limits loaded from environment variables.
 * Throws at startup if invalid values are provided.
 *
 * Env vars:
 *   RATE_LIMIT_WINDOW_MS        - Time window in ms (default: 60000)
 *   RATE_LIMIT_MAX_REQUESTS    - Max requests per window for general endpoints (default: 100)
 *   RATE_LIMIT_MAX_EVALUATE    - Max requests per window for /api/risk/evaluate (default: 10)
 */

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitConfigs {
  default: RateLimitConfig;
  evaluate: RateLimitConfig;
}

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
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
