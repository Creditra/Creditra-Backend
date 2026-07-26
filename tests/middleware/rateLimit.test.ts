import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitMiddleware,
  createIpKeyGenerator,
  createApiKeyKeyGenerator,
  createAdminBypassChecker,
  getClientIp,
} from '../../src/middleware/rateLimit.js';

interface FakeRedisBucket {
  tokens: number;
  lastRefill: number;
}

/** Minimal Redis client that implements the token-bucket Lua contract. */
class FakeRedisClient {
  isOpen = false;

  constructor(private readonly buckets = new Map<string, FakeRedisBucket>()) {}

  async connect(): Promise<void> {
    this.isOpen = true;
  }

  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<[number, number, number]> {
    const key = options.keys[0];
    const capacity = Number(options.arguments[0]);
    const windowMs = Number(options.arguments[1]);
    const now = Number(options.arguments[2]);
    const refillRate = capacity / windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
    } else {
      const elapsed = Math.max(0, now - bucket.lastRefill);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
      bucket.lastRefill = now;
    }

    let allowed = 0;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = 1;
    }
    this.buckets.set(key, bucket);

    const remaining = Math.max(0, Math.floor(bucket.tokens));
    let resetAt: number;
    if (bucket.tokens >= capacity) {
      resetAt = now;
    } else if (allowed === 1) {
      resetAt = now + Math.ceil((capacity - bucket.tokens) / refillRate);
    } else {
      resetAt = now + Math.ceil((1 - bucket.tokens) / refillRate);
    }

    return [allowed, remaining, resetAt];
  }
}

class RejectingRedisClient {
  isOpen = false;

  async connect(): Promise<void> {
    this.isOpen = true;
  }

  async eval(): Promise<never> {
    throw new Error('redis unavailable');
  }
}

class ConnectRejectingRedisClient {
  isOpen = false;

  async connect(): Promise<never> {
    throw new Error('redis connection refused');
  }

  async eval(): Promise<never> {
    throw new Error('eval should not be called');
  }
}

class HangingRedisClient {
  isOpen = false;

  async connect(): Promise<never> {
    return new Promise(() => undefined);
  }

  async eval(): Promise<never> {
    throw new Error('eval should not be called');
  }
}

function makeReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    ip: '127.0.0.1',
    headers: {},
    app: { get: () => undefined } as unknown as Request['app'],
    ...overrides,
  };
}

function makeRes() {
  const res: Partial<Response> = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

async function waitForAsyncMiddleware(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('createRateLimitMiddleware (token bucket)', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('calls next() when request count is within capacity', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 10,
      keyGenerator: createIpKeyGenerator(),
    });

    const req = makeReq({ ip: '192.168.1.1' });
    const res = makeRes();

    middleware(req as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sets X-RateLimit-* headers on every response', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 10,
      keyGenerator: createIpKeyGenerator(),
    });

    const req = makeReq({ ip: '10.0.0.1' });
    const res = makeRes();

    middleware(req as Request, res, next);

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': expect.any(String),
        'X-RateLimit-Reset': expect.any(String),
      }),
    );
  });

  it('returns 429 with retryAfter when the bucket is empty', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 2,
      keyGenerator: createIpKeyGenerator(),
    });

    const req = makeReq({ ip: '10.0.0.2' });
    const res = makeRes();

    middleware(req as Request, res, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(req as Request, res, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(req as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: null,
        error: expect.stringContaining('Too many requests'),
        retryAfter: expect.any(Number),
      }),
    );
    expect(res.set).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('tracks requests separately for different IP addresses', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 2,
      keyGenerator: createIpKeyGenerator(),
    });

    const res1 = makeRes();
    const res2 = makeRes();

    middleware(makeReq({ ip: '1.1.1.1' }) as Request, res1, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(makeReq({ ip: '2.2.2.2' }) as Request, res2, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(makeReq({ ip: '1.1.1.1' }) as Request, res1, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(makeReq({ ip: '1.1.1.1' }) as Request, res1, next);
    expect(res1.status).toHaveBeenCalledWith(429);
  });

  it('uses X-Forwarded-For header when present and trust proxy is off', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 2,
      keyGenerator: createIpKeyGenerator(),
    });

    const req = makeReq({
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '8.8.8.8, 1.1.1.1' },
    });
    const res = makeRes();

    middleware(req as Request, res, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(req as Request, res, next);
    expect(next).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    middleware(req as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('decrements X-RateLimit-Remaining as tokens are consumed', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 5,
      keyGenerator: createIpKeyGenerator(),
    });

    const req = makeReq({ ip: '5.5.5.5' });
    const res = makeRes();

    const remainingValues: number[] = [];

    for (let i = 0; i < 5; i++) {
      vi.clearAllMocks();
      middleware(req as Request, res, next);
      const setCall = (res.set as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => typeof c[0] === 'object' && 'X-RateLimit-Remaining' in c[0],
      );
      remainingValues.push(Number(setCall?.[0]['X-RateLimit-Remaining'] ?? -1));
    }

    expect(remainingValues).toEqual([4, 3, 2, 1, 0]);
  });

  it('includes retryAfter in 429 response', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
      keyGenerator: createIpKeyGenerator(),
    });

    const req = makeReq({ ip: '9.9.9.9' });
    const res = makeRes();

    middleware(req as Request, res, next);
    vi.clearAllMocks();

    middleware(req as Request, res, next);

    const jsonCall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonCall.retryAfter).toBeGreaterThan(0);
    expect(jsonCall.retryAfter).toBeLessThanOrEqual(60);
  });

  it('does not echo sensitive data in error response', () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
      keyGenerator: createApiKeyKeyGenerator(),
    });

    const req = makeReq({
      ip: '9.9.9.9',
      headers: { 'x-api-key': 'super-secret-key-123' },
    });
    const res = makeRes();

    middleware(req as Request, res, next);
    vi.clearAllMocks();

    middleware(req as Request, res, next);

    const jsonStr = JSON.stringify(
      (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(jsonStr).not.toContain('super-secret-key-123');
  });

  it('refills tokens over the window (token bucket)', () => {
    const store = new InMemoryRateLimitStore();
    const capacity = 2;
    const windowMs = 1_000;

    // Exhaust the bucket.
    expect(store.consume('k', capacity, windowMs).allowed).toBe(true);
    expect(store.consume('k', capacity, windowMs).allowed).toBe(true);
    expect(store.consume('k', capacity, windowMs).allowed).toBe(false);

    // Manually advance by half a window by poking lastRefill via a full window wait.
    // Since we can't freeze Date easily without vi.useFakeTimers:
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      // rebuild store under fake timers
      const timed = new InMemoryRateLimitStore();
      expect(timed.consume('refill', capacity, windowMs).allowed).toBe(true);
      expect(timed.consume('refill', capacity, windowMs).allowed).toBe(true);
      expect(timed.consume('refill', capacity, windowMs).allowed).toBe(false);

      // Advance one full window → full refill.
      vi.setSystemTime(now + windowMs + 1);
      const after = timed.consume('refill', capacity, windowMs);
      expect(after.allowed).toBe(true);
      expect(after.remaining).toBe(capacity - 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares Redis counters across simulated middleware instances', async () => {
    const buckets = new Map<string, FakeRedisBucket>();
    const storeA = new RedisRateLimitStore({
      url: 'redis://localhost:6379',
      prefix: 'test:ratelimit',
      client: new FakeRedisClient(buckets),
    });
    const storeB = new RedisRateLimitStore({
      url: 'redis://localhost:6379',
      prefix: 'test:ratelimit',
      client: new FakeRedisClient(buckets),
    });

    const first = await storeA.consume('client-1', 10, 60_000);
    const second = await storeB.consume('client-1', 10, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(first.remaining).toBe(9);
    expect(second.remaining).toBe(8);
  });

  it('fails open by default when Redis consume fails', async () => {
    const middleware = createRateLimitMiddleware(
      {
        windowMs: 60_000,
        maxRequests: 1,
        keyGenerator: createIpKeyGenerator(),
      },
      new RedisRateLimitStore({
        url: 'redis://localhost:6379',
        client: new RejectingRedisClient(),
      }),
    );

    const res = makeRes();
    middleware(makeReq() as Request, res, next);
    await waitForAsyncMiddleware();

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'X-RateLimit-Limit': '1',
        'X-RateLimit-Remaining': '1',
        'X-RateLimit-Reset': expect.any(String),
      }),
    );
  });

  it('can fail closed when Redis consume fails', async () => {
    const middleware = createRateLimitMiddleware(
      {
        windowMs: 60_000,
        maxRequests: 1,
        keyGenerator: createIpKeyGenerator(),
      },
      new RedisRateLimitStore({
        url: 'redis://localhost:6379',
        failureMode: 'closed',
        client: new RejectingRedisClient(),
      }),
    );

    const res = makeRes();
    middleware(makeReq() as Request, res, next);
    await waitForAsyncMiddleware();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: null,
        error: expect.stringContaining('Too many requests'),
        retryAfter: expect.any(Number),
      }),
    );
  });

  it('fails open when Redis connection fails before consuming', async () => {
    const onError = vi.fn();
    const store = new RedisRateLimitStore({
      url: 'redis://localhost:6379',
      client: new ConnectRejectingRedisClient(),
      onError,
    });

    const entry = await store.consume('client-1', 10, 60_000);

    expect(entry.allowed).toBe(true);
    expect(entry.remaining).toBe(10);
    expect(entry.resetAt).toBeGreaterThan(Date.now());
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('applies failure mode when Redis connection stalls', async () => {
    const onError = vi.fn();
    const store = new RedisRateLimitStore({
      url: 'redis://localhost:6379',
      failureMode: 'closed',
      operationTimeoutMs: 1,
      client: new HangingRedisClient(),
      onError,
    });

    const entry = await store.consume('client-1', 10, 60_000);

    expect(entry.allowed).toBe(false);
    expect(entry.remaining).toBe(0);
    expect(entry.resetAt).toBeGreaterThan(Date.now());
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('createAdminBypassChecker', () => {
  const SECRET = 'admin-bypass-secret';
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = SECRET;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = originalKey;
    }
  });

  it('returns true for a matching X-Admin-Api-Key', () => {
    const skip = createAdminBypassChecker();
    const req = makeReq({
      headers: { 'x-admin-api-key': SECRET },
    }) as Request;
    expect(skip(req)).toBe(true);
  });

  it('returns false when the header is missing', () => {
    const skip = createAdminBypassChecker();
    expect(skip(makeReq() as Request)).toBe(false);
  });

  it('returns false when the key is wrong', () => {
    const skip = createAdminBypassChecker();
    const req = makeReq({
      headers: { 'x-admin-api-key': 'not-the-secret' },
    }) as Request;
    expect(skip(req)).toBe(false);
  });

  it('returns false when ADMIN_API_KEY is unset', () => {
    delete process.env.ADMIN_API_KEY;
    const skip = createAdminBypassChecker();
    const req = makeReq({
      headers: { 'x-admin-api-key': SECRET },
    }) as Request;
    expect(skip(req)).toBe(false);
  });

  it('middleware skips charging the bucket and sets X-RateLimit-Bypass', () => {
    const store = new InMemoryRateLimitStore();
    const middleware = createRateLimitMiddleware(
      {
        windowMs: 60_000,
        maxRequests: 1,
        keyGenerator: createIpKeyGenerator(),
        skip: createAdminBypassChecker(),
      },
      store,
    );

    const next = vi.fn();
    const res = makeRes();
    const req = makeReq({
      ip: '7.7.7.7',
      headers: { 'x-admin-api-key': SECRET },
    });

    // Exhaust would be capacity 1 — but admin bypass never charges.
    for (let i = 0; i < 5; i++) {
      vi.clearAllMocks();
      middleware(req as Request, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'X-RateLimit-Bypass': 'admin',
          'X-RateLimit-Limit': '1',
          'X-RateLimit-Remaining': '1',
        }),
      );
    }

    // Without the admin header the same IP is still limited.
    vi.clearAllMocks();
    const normalNext = vi.fn();
    const normalRes = makeRes();
    middleware(
      makeReq({ ip: '7.7.7.7' }) as Request,
      normalRes,
      normalNext,
    );
    expect(normalNext).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    middleware(
      makeReq({ ip: '7.7.7.7' }) as Request,
      normalRes,
      normalNext,
    );
    expect(normalRes.status).toHaveBeenCalledWith(429);
  });
});

describe('createIpKeyGenerator / getClientIp', () => {
  it('returns req.ip when no X-Forwarded-For header', () => {
    const gen = createIpKeyGenerator();
    const req = makeReq({ ip: '192.168.0.1' }) as Request;
    expect(gen(req)).toBe('192.168.0.1');
  });

  it('returns first IP from X-Forwarded-For when present', () => {
    const gen = createIpKeyGenerator();
    const req = makeReq({
      ip: '127.0.0.1',
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    }) as Request;
    expect(gen(req)).toBe('1.2.3.4');
  });

  it('prefers Express req.ip when trust proxy is enabled', () => {
    const req = makeReq({
      ip: '10.0.0.50',
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      app: { get: (k: string) => (k === 'trust proxy' ? 1 : undefined) } as unknown as Request['app'],
    }) as Request;
    expect(getClientIp(req)).toBe('10.0.0.50');
  });

  it('returns "unknown" when req.ip is missing and no X-Forwarded-For', () => {
    const gen = createIpKeyGenerator();
    const req = makeReq({ ip: undefined }) as Request;
    expect(gen(req)).toBe('unknown');
  });
});

describe('createApiKeyKeyGenerator', () => {
  it('prefers API key over IP when API key is present', () => {
    const gen = createApiKeyKeyGenerator();
    const req = makeReq({
      ip: '192.168.1.1',
      headers: { 'x-api-key': 'my-api-key' },
    }) as Request;
    expect(gen(req)).toBe('apikey:my-api-key');
  });

  it('falls back to IP when API key is absent', () => {
    const gen = createApiKeyKeyGenerator();
    const req = makeReq({ ip: '192.168.1.1' }) as Request;
    expect(gen(req)).toBe('ip:192.168.1.1');
  });

  it('falls back to IP when API key is empty string', () => {
    const gen = createApiKeyKeyGenerator();
    const req = makeReq({
      ip: '192.168.1.1',
      headers: { 'x-api-key': '' },
    }) as Request;
    expect(gen(req)).toBe('ip:192.168.1.1');
  });
});
