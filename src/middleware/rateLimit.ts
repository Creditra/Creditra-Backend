/**
 * Per-route token-bucket rate limiter with pluggable storage.
 *
 * Algorithm
 * ---------
 * Each key owns a bucket of `maxRequests` tokens that refills continuously at
 * `maxRequests / windowMs` tokens per millisecond. A request costs one token.
 * When the bucket is empty the middleware returns `429` with `Retry-After` and
 * the `{ data, error, retryAfter }` envelope.
 *
 * Headers (every response that goes through the limiter)
 * ------------------------------------------------------
 * - `X-RateLimit-Limit`     — bucket capacity
 * - `X-RateLimit-Remaining` — whole tokens left after this request
 * - `X-RateLimit-Reset`     — epoch seconds when the bucket is next full
 * - `Retry-After`           — only on 429; seconds until one token is available
 * - `X-RateLimit-Bypass`    — set to `admin` when the admin/service bypass fires
 *
 * Storage
 * -------
 * Default store is an in-process `Map` (fine for single-instance deploys).
 * Pass a {@link RedisRateLimitStore} for shared counters across replicas —
 * the middleware public surface stays the same.
 *
 * Admin / service bypass
 * ----------------------
 * When {@link RateLimitOptions.skip} returns true (default helper:
 * {@link createAdminBypassChecker}), the request is not charged and
 * `X-RateLimit-Bypass: admin` is emitted. Bypass requires a configured
 * `ADMIN_API_KEY` and a matching `X-Admin-Api-Key` header (timing-safe).
 *
 * Client IP (proxy-safe)
 * ----------------------
 * Key generators prefer Express `req.ip` (honours `trust proxy`) and only
 * fall back to the first `X-Forwarded-For` hop when that is empty. Operators
 * behind a reverse proxy should set `app.set('trust proxy', …)` so spoofed
 * client-supplied XFF is not trusted blindly.
 *
 * See `docs/SECURITY.md` §5 for the operational tuning guide.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

import { ADMIN_KEY_HEADER } from './adminAuth.js';

// ── Public types ─────────────────────────────────────────────────────────────

/** Result of a single token-bucket consume attempt. */
export interface RateLimitResult {
  /** Whether the request may proceed. */
  allowed: boolean;
  /** Whole tokens remaining after this attempt (0 when denied). */
  remaining: number;
  /** Epoch-ms when the bucket will next be full (or when one token is ready). */
  resetAt: number;
}

/**
 * Pluggable store contract. Implementations may be sync (in-memory) or async
 * (Redis). The middleware awaits either shape.
 */
export interface RateLimitStore {
  consume(
    key: string,
    capacity: number,
    windowMs: number,
  ): RateLimitResult | Promise<RateLimitResult>;
}

/** @deprecated Prefer {@link RateLimitResult}; kept for type re-exports. */
export type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export interface RateLimitOptions {
  /** Refill window in milliseconds (tokens fully refill over this period). */
  windowMs: number;
  /** Bucket capacity and maximum sustained rate per window. */
  maxRequests: number;
  /** Derives the bucket key from the request (IP, API key, composite, …). */
  keyGenerator: (req: Request) => string;
  /**
   * When it returns true the request is not charged against the bucket.
   * Use {@link createAdminBypassChecker} for the documented admin/service path.
   */
  skip?: (req: Request) => boolean;
}

export type RedisRateLimitFailureMode = 'open' | 'closed';

export interface RedisRateLimitClient {
  isOpen?: boolean;
  connect(): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  on?(event: 'error', listener: (err: Error) => void): unknown;
  quit?(): Promise<unknown>;
  destroy?(): void;
}

export interface RedisRateLimitStoreOptions {
  url: string;
  prefix?: string;
  failureMode?: RedisRateLimitFailureMode;
  client?: RedisRateLimitClient;
  operationTimeoutMs?: number;
  onError?: (error: unknown) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const REDIS_OPERATION_TIMEOUT_MS = 500;

/**
 * Atomic token-bucket consume in Redis.
 *
 * KEYS[1] = namespaced bucket key
 * ARGV[1] = capacity
 * ARGV[2] = windowMs
 * ARGV[3] = nowMs
 *
 * Returns { allowed (0|1), remaining, resetAtMs }.
 */
const REDIS_CONSUME_SCRIPT = `
local capacity = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = 1

if capacity <= 0 or windowMs <= 0 then
  return { 0, 0, now + windowMs }
end

local refillRate = capacity / windowMs
local data = redis.call('HMGET', KEYS[1], 'tokens', 'lastRefill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  lastRefill = now
else
  local elapsed = now - lastRefill
  if elapsed < 0 then
    elapsed = 0
  end
  tokens = math.min(capacity, tokens + elapsed * refillRate)
  lastRefill = now
end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'lastRefill', tostring(lastRefill))
-- Keep the key at least until a full refill would complete.
redis.call('PEXPIRE', KEYS[1], math.ceil(windowMs * 2))

local remaining = math.floor(tokens)
if remaining < 0 then
  remaining = 0
end

local resetAt
if tokens >= capacity then
  resetAt = now
elseif allowed == 1 then
  -- Time until the bucket is full again.
  local deficit = capacity - tokens
  resetAt = now + math.ceil(deficit / refillRate)
else
  -- Time until one token is available.
  local need = cost - tokens
  if need < 0 then
    need = 0
  end
  resetAt = now + math.ceil(need / refillRate)
end

return { allowed, remaining, resetAt }
`;

// ── Client IP helpers ────────────────────────────────────────────────────────

/**
 * Resolve the client IP for rate-limit keys.
 *
 * Preference order:
 * 1. Express `req.ip` — respects `app.set('trust proxy', …)` so only the
 *    configured number of reverse-proxy hops are trusted.
 * 2. First hop of `X-Forwarded-For` when `req.ip` is empty (legacy / direct).
 * 3. `"unknown"` as a last resort so all anonymous clients share one bucket.
 */
export function getClientIp(req: Request): string {
  if (typeof req.ip === 'string' && req.ip.length > 0) {
    // When trust proxy is enabled, Express already peels XFF into req.ip.
    // When it is not, req.ip is the direct peer (safe: not client-spoofable).
    // Additionally honour explicit XFF only if the operator left trust proxy
    // off but still wants legacy behaviour via the left-most hop (documented).
    const trust = (req.app as { get?: (k: string) => unknown } | undefined)?.get?.('trust proxy');
    if (trust) {
      return req.ip;
    }
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  if (typeof req.ip === 'string' && req.ip.length > 0) {
    return req.ip;
  }

  return 'unknown';
}

export function createIpKeyGenerator(): (req: Request) => string {
  return (req: Request) => getClientIp(req);
}

export function createApiKeyKeyGenerator(): (req: Request) => string {
  return (req: Request) => {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      return `apikey:${apiKey}`;
    }
    return `ip:${getClientIp(req)}`;
  };
}

// ── Admin / service bypass ───────────────────────────────────────────────────

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

/**
 * Returns a skip predicate that bypasses rate limiting when the request
 * presents a valid `X-Admin-Api-Key` matching `ADMIN_API_KEY`.
 *
 * Security notes:
 * - Timing-safe comparison (SHA-256 digests + length check).
 * - No bypass when `ADMIN_API_KEY` is unset (fail closed for the bypass path).
 * - The key value is never logged or echoed.
 */
export function createAdminBypassChecker(
  options: {
    /** Header name to inspect. Defaults to `x-admin-api-key`. */
    headerName?: string;
    /** Env var holding the expected key. Defaults to `ADMIN_API_KEY`. */
    envVar?: string;
  } = {},
): (req: Request) => boolean {
  const headerName = (options.headerName ?? ADMIN_KEY_HEADER).toLowerCase();
  const envVar = options.envVar ?? 'ADMIN_API_KEY';

  return (req: Request): boolean => {
    const expected = process.env[envVar];
    if (typeof expected !== 'string' || expected.length === 0) {
      return false;
    }

    const provided = req.headers[headerName];
    if (typeof provided !== 'string' || provided.length === 0) {
      return false;
    }

    return timingSafeStringEqual(provided, expected);
  };
}

// ── In-memory token bucket ───────────────────────────────────────────────────

interface MemoryBucket {
  tokens: number;
  lastRefillAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, MemoryBucket>();

  consume(key: string, capacity: number, windowMs: number): RateLimitResult {
    this.cleanup(capacity, windowMs);

    const now = Date.now();
    const result = consumeTokenBucket(
      this.store.get(key),
      capacity,
      windowMs,
      now,
    );
    this.store.set(key, result.bucket);
    return result.outcome;
  }

  /** Test/inspection helper: number of live buckets. */
  get size(): number {
    return this.store.size;
  }

  cleanup(capacity = 1, windowMs = 60_000): void {
    const now = Date.now();
    // Evict buckets that have been full (or idle) longer than 2× window.
    const idleMs = Math.max(windowMs * 2, 1);
    for (const [key, bucket] of this.store.entries()) {
      const elapsed = now - bucket.lastRefillAt;
      if (elapsed >= idleMs && bucket.tokens >= capacity) {
        this.store.delete(key);
      }
    }
  }
}

// ── Redis token bucket ───────────────────────────────────────────────────────

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisRateLimitClient;
  private readonly prefix: string;
  private readonly failureMode: RedisRateLimitFailureMode;
  private readonly operationTimeoutMs: number;
  private readonly onError: (error: unknown) => void;
  private connectPromise: Promise<void> | undefined;

  constructor(options: RedisRateLimitStoreOptions) {
    this.client = options.client ?? (createClient({
      url: options.url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: REDIS_OPERATION_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    }) as unknown as RedisRateLimitClient);
    this.prefix = options.prefix ?? 'ratelimit';
    this.failureMode = options.failureMode ?? 'open';
    this.operationTimeoutMs = options.operationTimeoutMs ?? REDIS_OPERATION_TIMEOUT_MS;
    this.onError = options.onError ?? (() => undefined);

    this.client.on?.('error', (err) => {
      this.onError(err);
    });
  }

  async consume(key: string, capacity: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();

    try {
      await this.connect();
      const result = await withTimeout(
        this.client.eval(REDIS_CONSUME_SCRIPT, {
          keys: [this.buildKey(key)],
          arguments: [String(capacity), String(windowMs), String(now)],
        }),
        this.operationTimeoutMs,
        'Redis rate-limit consume',
      );
      return parseRedisConsumeResult(result);
    } catch (error) {
      this.onError(error);
      return this.fallbackResult(now, windowMs, capacity);
    }
  }

  /**
   * Back-compat shim for callers/tests that still invoke `increment`.
   * Maps token-bucket results onto the legacy `{ count, resetAt }` shape
   * where `count` is the number of tokens consumed in the current "virtual
   * window" (capacity − remaining, or capacity + 1 when denied).
   */
  async increment(key: string, windowMs: number, capacity = 100): Promise<RateLimitEntry> {
    const result = await this.consume(key, capacity, windowMs);
    const count = result.allowed
      ? Math.max(1, capacity - result.remaining)
      : capacity + 1;
    return { count, resetAt: result.resetAt };
  }

  async close(): Promise<void> {
    if (this.client.isOpen && this.client.quit) {
      await this.client.quit();
      return;
    }

    this.client.destroy?.();
  }

  private async connect(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    const connectPromise = this.connectPromise ?? this.client.connect().then(() => undefined);
    this.connectPromise = connectPromise;

    try {
      await withTimeout(
        connectPromise,
        this.operationTimeoutMs,
        'Redis rate-limit connect',
      );
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = undefined;
      }
    }
  }

  private buildKey(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return `${this.prefix}:${digest}`;
  }

  private fallbackResult(now: number, windowMs: number, capacity: number): RateLimitResult {
    if (this.failureMode === 'open') {
      return {
        allowed: true,
        remaining: capacity,
        resetAt: now + windowMs,
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: now + windowMs,
    };
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────

function applyRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number,
  bypass?: string,
): void {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  };
  if (bypass) {
    headers['X-RateLimit-Bypass'] = bypass;
  }
  res.set(headers);
}

function applyDenied(
  res: Response,
  limit: number,
  resetAt: number,
): void {
  const now = Date.now();
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  applyRateLimitHeaders(res, limit, 0, resetAt);
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    data: null,
    error: `Too many requests. Please retry after ${retryAfter} seconds.`,
    retryAfter,
  });
}

export function createRateLimitMiddleware(
  options: RateLimitOptions,
  store: RateLimitStore = new InMemoryRateLimitStore(),
) {
  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (options.skip?.(req)) {
      applyRateLimitHeaders(
        res,
        options.maxRequests,
        options.maxRequests,
        Date.now() + options.windowMs,
        'admin',
      );
      next();
      return;
    }

    const key = options.keyGenerator(req);
    const result = store.consume(key, options.maxRequests, options.windowMs);

    const handle = (outcome: RateLimitResult): void => {
      if (!outcome.allowed) {
        applyDenied(res, options.maxRequests, outcome.resetAt);
        return;
      }

      applyRateLimitHeaders(
        res,
        options.maxRequests,
        outcome.remaining,
        outcome.resetAt,
      );
      next();
    };

    if (isPromiseLike(result)) {
      void result.then(handle).catch((error: unknown) => {
        next(error);
      });
      return;
    }

    handle(result);
  };
}

// ── Pure token-bucket math (shared by memory store / tests) ──────────────────

function consumeTokenBucket(
  existing: MemoryBucket | undefined,
  capacity: number,
  windowMs: number,
  now: number,
): { bucket: MemoryBucket; outcome: RateLimitResult } {
  const safeCapacity = Math.max(1, capacity);
  const safeWindow = Math.max(1, windowMs);
  const refillRate = safeCapacity / safeWindow;

  let tokens: number;
  let lastRefillAt: number;

  if (!existing) {
    tokens = safeCapacity;
    lastRefillAt = now;
  } else {
    const elapsed = Math.max(0, now - existing.lastRefillAt);
    tokens = Math.min(safeCapacity, existing.tokens + elapsed * refillRate);
    lastRefillAt = now;
  }

  if (tokens >= 1) {
    tokens -= 1;
    const remaining = Math.floor(tokens);
    const deficit = safeCapacity - tokens;
    const resetAt = deficit <= 0
      ? now
      : now + Math.ceil(deficit / refillRate);
    return {
      bucket: { tokens, lastRefillAt },
      outcome: { allowed: true, remaining: Math.max(0, remaining), resetAt },
    };
  }

  const need = 1 - tokens;
  const resetAt = now + Math.ceil(need / refillRate);
  return {
    bucket: { tokens, lastRefillAt },
    outcome: { allowed: false, remaining: 0, resetAt },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRedisConsumeResult(result: unknown): RateLimitResult {
  if (!Array.isArray(result) || result.length < 3) {
    throw new Error('Redis rate-limit consume returned an invalid response');
  }

  const allowedFlag = Number(result[0]);
  const remaining = Number(result[1]);
  const resetAt = Number(result[2]);

  if (![allowedFlag, remaining, resetAt].every(Number.isFinite)) {
    throw new Error('Redis rate-limit consume returned non-numeric values');
  }

  return {
    allowed: allowedFlag === 1,
    remaining: Math.max(0, Math.floor(remaining)),
    resetAt,
  };
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    void operation
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function'
  );
}
