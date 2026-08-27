import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createTenantMutationRateLimiter, InMemoryTenantRateLimitStore } from '../tenantRateLimit.js';

function req(method: string, tenant = 'tenant-1', route = '/api/credit/lines', subject = 'Bearer user-1'): Request {
  const split = route.lastIndexOf('/');
  return {
    method,
    path: route.slice(split),
    baseUrl: route.slice(0, split),
    headers: { 'x-tenant-id': tenant, authorization: subject },
  } as unknown as Request;
}

function withHeaders(base: Request, headers: Record<string, string>): Request {
  return Object.assign(base, { headers }) as Request;
}

function res(): Response & { statusCode: number; headers: Record<string, string>; body?: unknown } {
  const output = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    set(values: Record<string, string> | string, value?: string) {
      if (typeof values === 'string') this.headers[values] = value ?? '';
      else Object.assign(this.headers, values);
    },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return output as unknown as Response & { statusCode: number; headers: Record<string, string>; body?: unknown };
}

describe('tenant rate-limit integration behavior', () => {
  it('scopes the default route key to the mounted API path', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1 });
    const next = vi.fn();
    const first = res();
    await limiter(req('POST', 'tenant-1', '/api/credit/lines'), first, next);
    const differentApi = res();
    await limiter(req('POST', 'tenant-1', '/api/risk/evaluate'), differentApi, next);
    expect(differentApi.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps the budget tenant-scoped while retaining custom subject attribution', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, resolveSubject: (request) => String(request.headers['x-user-id'] ?? 'unknown') });
    const next = vi.fn();
    const headers = { 'x-tenant-id': 'tenant-1', 'x-user-id': 'user-a' };
    await limiter(req('POST', 'tenant-1'), res(), next);
    const blocked = res();
    await limiter(withHeaders(req('POST', 'tenant-1'), headers), blocked, next);
    expect(blocked.statusCode).toBe(429);
    const userA = res();
    await limiter(withHeaders(req('POST', 'tenant-1'), headers), userA, next);
    expect(userA.statusCode).toBe(429);
  });

  it('allows custom route classes to group equivalent mutation endpoints', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, resolveRouteClass: () => 'credit-mutation' });
    const next = vi.fn();
    await limiter(req('POST', 'tenant-1', '/api/credit/lines'), res(), next);
    const second = res();
    await limiter(req('PUT', 'tenant-1', '/api/credit/lines/123'), second, next);
    expect(second.statusCode).toBe(429);
  });

  it('returns a complete structured error body when a budget is exceeded', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 2_000, maxRequests: 1, now: () => 1_000 });
    const next = vi.fn();
    await limiter(req('POST'), res(), next);
    const blocked = res();
    await limiter(req('POST'), blocked, next);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual({ data: null, error: expect.stringContaining('Retry after'), retryAfter: 2 });
    expect(blocked.headers['Retry-After']).toBe('2');
    expect(blocked.headers['X-RateLimit-Scope']).toBe('tenant-1:POST:/api/credit/lines');
  });

  it('does not call downstream handlers after denial', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1 });
    const next = vi.fn() as unknown as NextFunction;
    await limiter(req('POST'), res(), next);
    await limiter(req('POST'), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows a permitted override without changing the normal store bucket', async () => {
    const store = new InMemoryTenantRateLimitStore();
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, isOverrideAllowed: () => true }, store);
    const next = vi.fn();
    await limiter(req('POST', 'tenant-1'), res(), next);
    await limiter(withHeaders(req('POST', 'tenant-1'), { 'x-rate-limit-override': 'true', 'x-tenant-id': 'tenant-1' }), res(), next);
    const normal = res();
    await limiter(req('POST', 'tenant-1'), normal, next);
    expect(normal.statusCode).toBe(429);
  });

  it('awaits asynchronous override authorization and audit hooks', async () => {
    const events: string[] = [];
    const limiter = createTenantMutationRateLimiter({
      windowMs: 1_000,
      maxRequests: 1,
      isOverrideAllowed: async () => { events.push('authorized'); return true; },
      auditOverride: async () => { await Promise.resolve(); events.push('audited'); },
    });
    await limiter(withHeaders(req('POST'), { 'x-rate-limit-override': 'true', 'x-tenant-id': 'tenant-1' }), res(), vi.fn());
    expect(events).toEqual(['authorized', 'audited']);
  });

  it('does not audit a request that only presents a false override flag', async () => {
    const audit = vi.fn();
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, isOverrideAllowed: () => false, auditOverride: audit });
    await limiter(withHeaders(req('POST'), { 'x-rate-limit-override': 'false', 'x-tenant-id': 'tenant-1' }), res(), vi.fn());
    expect(audit).not.toHaveBeenCalled();
  });

  it('handles DELETE as a mutation and OPTIONS as a read', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1 });
    const next = vi.fn();
    await limiter(req('DELETE'), res(), next);
    const blockedDelete = res();
    await limiter(req('DELETE'), blockedDelete, next);
    expect(blockedDelete.statusCode).toBe(429);
    const options = res();
    await limiter(req('OPTIONS'), options, next);
    expect(options.statusCode).toBe(200);
  });

  it('keeps reset headers in epoch seconds and never reports negative retry time', async () => {
    let now = 1_999;
    const limiter = createTenantMutationRateLimiter({ windowMs: 1, maxRequests: 1, now: () => now });
    await limiter(withHeaders(req('POST'), { 'x-rate-limit-override': 'true' }), res(), vi.fn());
    now = 2_001;
    const after = res();
    await limiter(req('POST'), after, vi.fn());
    expect(Number(after.headers['X-RateLimit-Reset'])).toBeGreaterThanOrEqual(2);
    expect(Number(after.headers['Retry-After'] ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('rejects a custom resolver that returns an empty route class', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, resolveRouteClass: () => '  ' });
    const result = res();
    await limiter(req('POST'), result, vi.fn());
    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({ data: null, error: expect.stringContaining('route') });
  });

  it('does not leak a tenant identifier into the denial message', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1 });
    await limiter(req('POST', 'secret-tenant'), res(), vi.fn());
    const denied = res();
    await limiter(req('POST', 'secret-tenant'), denied, vi.fn());
    expect(JSON.stringify(denied.body)).not.toContain('secret-tenant');
  });

  it('rejects invalid limiter configuration at construction time', () => {
    expect(() => createTenantMutationRateLimiter({ windowMs: 0, maxRequests: 1 })).toThrow('windowMs');
    expect(() => createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 0 })).toThrow('maxRequests');
    expect(() => createTenantMutationRateLimiter({ windowMs: -1, maxRequests: -1 })).toThrow('windowMs');
  });

  it('normalizes whitespace around tenant and route resolver values', async () => {
    const seen: string[] = [];
    const limiter = createTenantMutationRateLimiter({
      windowMs: 1_000,
      maxRequests: 1,
      resolveTenant: () => ' tenant-normalized ',
      resolveRouteClass: () => ' mutation ',
      resolveSubject: () => ' subject ',
      auditOverride: (entry) => { seen.push(`${entry.tenantId}:${entry.routeClass}:${entry.subject}`); },
      isOverrideAllowed: () => true,
    });
    await limiter(withHeaders(req('POST'), { 'x-rate-limit-override': 'true' }), res(), vi.fn());
    expect(seen).toEqual(['tenant-normalized:mutation:subject']);
  });

  it('keeps two tenants independent across several route classes', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1 });
    const next = vi.fn();
    for (const route of ['/lines', '/draw', '/repay']) {
      await limiter(req('POST', 'tenant-a', `/api/credit${route}`), res(), next);
      const secondTenant = res();
      await limiter(req('POST', 'tenant-b', `/api/credit${route}`), secondTenant, next);
      expect(secondTenant.statusCode).toBe(200);
    }
    expect(next).toHaveBeenCalledTimes(6);
  });

  it('does not consume a bucket when identity validation fails', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, resolveTenant: () => '' });
    const next = vi.fn();
    const invalid = res();
    await limiter(req('POST'), invalid, next);
    expect(invalid.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the request clock consistently for reset and audit timestamps', async () => {
    const now = 123_456;
    const audit = vi.fn();
    const limiter = createTenantMutationRateLimiter({ windowMs: 2_000, maxRequests: 1, now: () => now, isOverrideAllowed: () => true, auditOverride: audit });
    await limiter(withHeaders(req('POST'), { 'x-rate-limit-override': 'true' }), res(), vi.fn());
    expect(audit.mock.calls[0][0].at).toEqual(new Date(now));
    const allowed = res();
    await limiter(req('POST'), allowed, vi.fn());
    expect(allowed.headers['X-RateLimit-Reset']).toBe(String(Math.ceil((now + 2_000) / 1_000)));
  });

  it('counts POST, PUT, PATCH, and DELETE independently only by route class', async () => {
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 2, resolveRouteClass: () => 'all-credit-mutations' });
    const next = vi.fn();
    await limiter(req('POST'), res(), next);
    await limiter(req('PUT'), res(), next);
    const denied = res();
    await limiter(req('PATCH'), denied, next);
    expect(denied.statusCode).toBe(429);
  });

  it('preserves the same limit headers when a custom store is used', async () => {
    const store = new InMemoryTenantRateLimitStore();
    const limiter = createTenantMutationRateLimiter({ windowMs: 60_000, maxRequests: 4 }, store);
    const result = res();
    await limiter(req('POST'), result, vi.fn());
    expect(result.headers).toEqual(expect.objectContaining({
      'X-RateLimit-Limit': '4',
      'X-RateLimit-Remaining': '3',
      'X-RateLimit-Scope': 'tenant-1:POST:/api/credit/lines',
    }));
  });

  it('does not call an audit hook for an allowed request without override', async () => {
    const audit = vi.fn();
    const limiter = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, auditOverride: audit });
    await limiter(req('POST'), res(), vi.fn());
    expect(audit).not.toHaveBeenCalled();
  });
});
