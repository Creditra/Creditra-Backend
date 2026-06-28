import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import {
  RedisRateLimitStore,
  createRateLimitMiddleware,
  createIpKeyGenerator,
  createApiKeyKeyGenerator,
} from '../../src/middleware/rateLimit.js';

interface FakeRedisBucket {
  count: number;
  resetAt: number;
}

class FakeRedisClient {
  isOpen = false;

  constructor(private readonly buckets = new Map<string, FakeRedisBucket>()) {}

  async connect(): Promise<void> {
    this.isOpen = true;
  }

  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<[number, number]> {
    const key = options.keys[0];
    const windowMs = Number(options.arguments[0]);
    const now = Date.now();
    const existing = this.buckets.get(key);
    const active = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

    active.count++;
    this.buckets.set(key, active);

    return [active.count, Math.max(0, active.resetAt - now)];
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

describe('createRateLimitMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('calls next() when request count is within limit', () => {
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

  it('returns 429 with retryAfter when limit is exceeded', () => {
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

  it('uses X-Forwarded-For header when present', () => {
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

  it('decrements X-RateLimit-Remaining as requests are made', () => {
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

    const first = await storeA.increment('client-1', 60_000);
    const second = await storeB.increment('client-1', 60_000);

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(Math.abs(second.resetAt - first.resetAt)).toBeLessThanOrEqual(5);
  });

  it('fails open by default when Redis increment fails', async () => {
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

  it('can fail closed when Redis increment fails', async () => {
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

  it('fails open when Redis connection fails before incrementing', async () => {
    const onError = vi.fn();
    const store = new RedisRateLimitStore({
      url: 'redis://localhost:6379',
      client: new ConnectRejectingRedisClient(),
      onError,
    });

    const entry = await store.increment('client-1', 60_000);

    expect(entry.count).toBe(0);
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

    const entry = await store.increment('client-1', 60_000);

    expect(entry.count).toBe(Number.MAX_SAFE_INTEGER);
    expect(entry.resetAt).toBeGreaterThan(Date.now());
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('createIpKeyGenerator', () => {
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
