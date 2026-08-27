import type { NextFunction, Request, Response } from 'express';

export type TenantRateLimitAudit = (entry: {
  tenantId: string;
  routeClass: string;
  subject: string;
  reason: 'override';
  at: Date;
}) => void | Promise<void>;

export interface TenantRateLimitOptions {
  windowMs: number;
  maxRequests: number;
  resolveTenant?: (req: Request) => string;
  resolveRouteClass?: (req: Request) => string;
  resolveSubject?: (req: Request) => string;
  isOverrideAllowed?: (req: Request) => boolean | Promise<boolean>;
  auditOverride?: TenantRateLimitAudit;
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface TenantRateLimitStore {
  consume(key: string, now: number, windowMs: number): Bucket;
  clear(): void;
}

/** Fixed-window store with an explicit reset boundary per tenant/route key. */
export class InMemoryTenantRateLimitStore implements TenantRateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, now: number, windowMs: number): Bucket {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  clear(): void { this.buckets.clear(); }
}

function defaultTenant(req: Request): string {
  const header = req.headers['x-tenant-id'];
  return typeof header === 'string' && header.trim() !== '' ? header.trim() : 'anonymous';
}

function defaultRouteClass(req: Request): string {
  return `${req.method.toUpperCase()}:${req.baseUrl || ''}${req.path || ''}`;
}

function defaultSubject(req: Request): string {
  const header = req.headers.authorization;
  return typeof header === 'string' && header !== '' ? 'authenticated' : 'anonymous';
}

function isMutation(req: Request): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
}

/**
 * Tenant/route scoped mutation limiter. The store is injectable so a Redis
 * implementation can use an atomic INCR+EXPIRE without changing callers.
 */
export function createTenantMutationRateLimiter(
  options: TenantRateLimitOptions,
  store: TenantRateLimitStore = new InMemoryTenantRateLimitStore(),
) {
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) throw new Error('windowMs must be positive');
  if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) throw new Error('maxRequests must be positive');
  const resolveTenant = options.resolveTenant ?? defaultTenant;
  const resolveRouteClass = options.resolveRouteClass ?? defaultRouteClass;
  const resolveSubject = options.resolveSubject ?? defaultSubject;
  const now = options.now ?? Date.now;

  return async function tenantMutationRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!isMutation(req)) { next(); return; }
    const tenantId = resolveTenant(req).trim();
    const routeClass = resolveRouteClass(req).trim();
    const subject = resolveSubject(req).trim();
    if (!tenantId || !routeClass || !subject) {
      res.status(400).json({ data: null, error: 'Tenant, route, and subject identity are required.' });
      return;
    }

    const overrideRequested = req.headers['x-rate-limit-override'] === 'true';
    const overrideAllowed = overrideRequested && options.isOverrideAllowed
      ? await options.isOverrideAllowed(req)
      : false;
    const key = `${tenantId}:${routeClass}`;
    const bucket = overrideAllowed
      ? { count: 0, resetAt: now() + options.windowMs }
      : store.consume(key, now(), options.windowMs);
    const remaining = overrideAllowed ? options.maxRequests : Math.max(0, options.maxRequests - bucket.count);
    res.set({
      'X-RateLimit-Limit': String(options.maxRequests),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
      'X-RateLimit-Scope': `${tenantId}:${routeClass}`,
    });

    if (overrideAllowed) {
      await options.auditOverride?.({ tenantId, routeClass, subject, reason: 'override', at: new Date(now()) });
      next();
      return;
    }
    if (bucket.count > options.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ data: null, error: `Too many mutation requests. Retry after ${retryAfter} seconds.`, retryAfter });
      return;
    }
    next();
  };
}
