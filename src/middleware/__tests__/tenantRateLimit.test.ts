import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createTenantMutationRateLimiter, InMemoryTenantRateLimitStore } from '../tenantRateLimit.js';

function request(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    path: '/lines',
    baseUrl: '/api/credit',
    headers: { 'x-tenant-id': 'tenant-a', authorization: 'Bearer token' },
    ...overrides,
  } as Request;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    set: vi.fn((values: Record<string, string> | string, value?: string) => {
      if (typeof values === 'string') headers[values] = value ?? '';
      else Object.assign(headers, values);
    }),
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value; }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    headers,
  } as unknown as Response & { headers: Record<string, string> };
  return res;
}

describe('tenant mutation rate limiter', () => {
  it('isolates counts by tenant and route class', async () => {
    let now = 1_000;
    const middleware = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, now: () => now });
    const next = vi.fn();
    const first = response();
    await middleware(request(), first, next);
    const blocked = response();
    await middleware(request(), blocked, next);
    expect(blocked.status).toHaveBeenCalledWith(429);
    const otherTenant = response();
    await middleware(request({ headers: { 'x-tenant-id': 'tenant-b' } }), otherTenant, next);
    expect(otherTenant.status).not.toHaveBeenCalledWith(429);
    const otherRoute = response();
    await middleware(request({ path: '/risk' }), otherRoute, next);
    expect(otherRoute.status).not.toHaveBeenCalledWith(429);
    now += 1_000;
    const reset = response();
    await middleware(request(), reset, next);
    expect(reset.status).not.toHaveBeenCalledWith(429);
  });

  it('sets truthful headers on allowed and rejected responses', async () => {
    const middleware = createTenantMutationRateLimiter({ windowMs: 10_000, maxRequests: 2, now: () => 1_000 });
    const next = vi.fn();
    const first = response();
    await middleware(request(), first, next);
    expect(first.headers['X-RateLimit-Limit']).toBe('2');
    expect(first.headers['X-RateLimit-Remaining']).toBe('1');
    const second = response();
    await middleware(request(), second, next);
    expect(second.headers['X-RateLimit-Remaining']).toBe('0');
    const third = response();
    await middleware(request(), third, next);
    expect(third.headers['X-RateLimit-Remaining']).toBe('0');
    expect(third.headers['Retry-After']).toBe('10');
  });

  it('does not count read requests against the mutation budget', async () => {
    const middleware = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1 });
    const next = vi.fn();
    const read = response();
    await middleware(request({ method: 'GET' }), read, next);
    const mutation = response();
    await middleware(request(), mutation, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(mutation.status).not.toHaveBeenCalledWith(429);
  });

  it('uses a fixed reset boundary rather than extending on each request', async () => {
    let now = 5_000;
    const middleware = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 2, now: () => now });
    const next = vi.fn();
    await middleware(request(), response(), next);
    now = 5_900;
    const second = response();
    await middleware(request(), second, next);
    expect(second.headers['X-RateLimit-Reset']).toBe('6');
    now = 6_000;
    const after = response();
    await middleware(request(), after, next);
    expect(after.headers['X-RateLimit-Remaining']).toBe('1');
  });

  it('requires all scoped identity components', async () => {
    const middleware = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, resolveTenant: () => ' ' });
    const res = response();
    await middleware(request(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('audits a permitted administrative override and does not consume capacity', async () => {
    const audit = vi.fn();
    const middleware = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, isOverrideAllowed: () => true, auditOverride: audit });
    const next = vi.fn();
    await middleware(request({ headers: { 'x-tenant-id': 'tenant-a', 'x-rate-limit-override': 'true' } }), response(), next);
    await middleware(request(), response(), next);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', routeClass: 'POST:/api/credit/lines', reason: 'override' }));
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('does not grant an override when it is requested but unauthorized', async () => {
    const middleware = createTenantMutationRateLimiter({ windowMs: 1_000, maxRequests: 1, isOverrideAllowed: () => false });
    const next = vi.fn();
    await middleware(request({ headers: { 'x-tenant-id': 'tenant-a', 'x-rate-limit-override': 'true' } }), response(), next);
    const blocked = response();
    await middleware(request({ headers: { 'x-tenant-id': 'tenant-a', 'x-rate-limit-override': 'true' } }), blocked, next);
    expect(blocked.status).toHaveBeenCalledWith(429);
  });

  it('supports a shared injectable store for deterministic reset/inspection', () => {
    const store = new InMemoryTenantRateLimitStore();
    expect(store.consume('tenant-a:POST:/lines', 0, 100)).toEqual({ count: 1, resetAt: 100 });
    expect(store.consume('tenant-a:POST:/lines', 99, 100).count).toBe(2);
    expect(store.consume('tenant-a:POST:/lines', 100, 100)).toEqual({ count: 1, resetAt: 200 });
    store.clear();
    expect(store.consume('tenant-a:POST:/lines', 0, 100).count).toBe(1);
  });
});
