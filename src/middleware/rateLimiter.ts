import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { fail } from '../utils/response.js';

type KeyGenerator = (req: Request) => string;

export type RateLimitStore = {
  get(key: string): { count: number; resetAt: number } | undefined;
  set(key: string, value: { count: number; resetAt: number }): void;
  delete(key: string): void;
};

class InMemoryStore implements RateLimitStore {
  private map = new Map<string, { count: number; resetAt: number }>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: { count: number; resetAt: number }) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

export type RateLimiterOptions = {
  windowMs?: number;
  max?: number;
  keyGenerator?: KeyGenerator;
  store?: RateLimitStore;
  message?: string;
  enabled?: boolean;
};

const defaultKeyGenerator: KeyGenerator = (req) => {
  const xfwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xfwd || req.ip || (req.socket.remoteAddress ?? 'unknown');
};

export function createRateLimiter(opts: RateLimiterOptions = {}): RequestHandler {
  const keyGenerator = opts.keyGenerator ?? defaultKeyGenerator;
  const store = opts.store ?? new InMemoryStore();

  return (req: Request, res: Response, next: NextFunction) => {
    const env = process.env.NODE_ENV ?? 'development';
    const enabled = opts.enabled ?? process.env.RATE_LIMIT_ENABLED !== 'false';
    const windowMs =
      opts.windowMs ??
      (process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) : env === 'development' ? 1000 : 60000);
    const max =
      opts.max ??
      (process.env.RATE_LIMIT_MAX_PUBLIC ? parseInt(process.env.RATE_LIMIT_MAX_PUBLIC, 10) : env === 'development' ? 50 : 30);
    const message = opts.message ?? (process.env.RATE_LIMIT_MESSAGE || 'Rate limit exceeded. Try again later.');

    if (!enabled) {
      next();
      return;
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count < max) {
      store.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
      next();
      return;
    }

    res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
    fail(res, message, 429);
  };
}

export default createRateLimiter();
