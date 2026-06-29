/**
 * Fixed-window rate limiter with pluggable storage.
 *
 * Each request is bucketed by a caller-supplied key (IP, API key, or a
 * composite) for the duration of `windowMs`. Once a bucket exceeds
 * `maxRequests` the middleware returns `429` with `Retry-After` and the
 * `{ data, error, retryAfter }` envelope.
 *
 * Every response (allowed or denied) carries the standard headers:
 * - `X-RateLimit-Limit`
 * - `X-RateLimit-Remaining`
 * - `X-RateLimit-Reset` (epoch seconds)
 *
 * The default store is a `Map` and therefore single-process. A horizontally
 * scaled deployment can pass a Redis-backed store without touching the
 * middleware's public surface — the {@link RateLimitOptions} contract and the
 * two ready-made key generators are intentionally storage-agnostic.
 *
 * See `docs/SECURITY.md` §5 for the operational tuning guide.
 */
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): RateLimitEntry | Promise<RateLimitEntry>;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (req: Request) => string;
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

const REDIS_OPERATION_TIMEOUT_MS = 500;
const REDIS_INCREMENT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
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

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, RateLimitEntry>();

  increment(key: string, windowMs: number): RateLimitEntry {
    this.cleanup();

    const now = Date.now();
    const resetAt = now + windowMs;
    const entry = this.getOrCreateEntry(key, resetAt, now);
    entry.count++;
    entry.resetAt = resetAt;
    this.store.set(key, entry);

    return { count: entry.count, resetAt: entry.resetAt };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private getOrCreateEntry(key: string, resetAt: number, now: number): RateLimitEntry {
    const existing = this.store.get(key);
    if (existing && existing.resetAt > now) {
      return existing;
    }
    return { count: 0, resetAt };
  }
}

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

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();

    try {
      await this.connect();
      const result = await withTimeout(
        this.client.eval(REDIS_INCREMENT_SCRIPT, {
          keys: [this.buildKey(key)],
          arguments: [String(windowMs)],
        }),
        this.operationTimeoutMs,
        'Redis rate-limit increment',
      );
      const { count, ttlMs } = parseRedisIncrementResult(result);
      return {
        count,
        resetAt: now + (ttlMs > 0 ? ttlMs : windowMs),
      };
    } catch (error) {
      this.onError(error);
      return this.fallbackEntry(now, windowMs);
    }
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

  private fallbackEntry(now: number, windowMs: number): RateLimitEntry {
    return {
      count: this.failureMode === 'open' ? 0 : Number.MAX_SAFE_INTEGER,
      resetAt: now + windowMs,
    };
  }
}

function parseRedisIncrementResult(result: unknown): { count: number; ttlMs: number } {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Redis rate-limit increment returned an invalid response');
  }

  const count = Number(result[0]);
  const ttlMs = Number(result[1]);

  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
    throw new Error('Redis rate-limit increment returned non-numeric values');
  }

  return { count, ttlMs };
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

export function createRateLimitMiddleware(
  options: RateLimitOptions,
  store: RateLimitStore = new InMemoryRateLimitStore(),
) {
  const applyRateLimitResult = (entry: RateLimitEntry, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const limit = options.maxRequests;
    const remaining = Math.max(0, limit - entry.count);
    const resetEpoch = Math.ceil(entry.resetAt / 1000);

    res.set({
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetEpoch),
    });

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        data: null,
        error: `Too many requests. Please retry after ${retryAfter} seconds.`,
        retryAfter,
      });
      return;
    }

    next();
  };

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const key = options.keyGenerator(req);

    const result = store.increment(key, options.windowMs);
    if (isPromiseLike(result)) {
      void result.then((entry) => {
        applyRateLimitResult(entry, res, next);
      }).catch((error: unknown) => {
        next(error);
      });
      return;
    }

    applyRateLimitResult(result, res, next);
  };
}
