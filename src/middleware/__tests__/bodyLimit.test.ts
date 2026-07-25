import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createBodyLimitMiddleware,
  createJsonBodyLimitVerify,
  createPathAwareBodyLimitMiddleware,
  isPayloadTooLargeError,
  PayloadTooLargeError,
  respondPayloadTooLarge,
  type RequestWithBodyLimit,
} from '../bodyLimit.js';
import {
  BODY_LIMIT_BULK_BYTES,
  BODY_LIMIT_DEFAULT_BYTES,
  loadBodyLimitConfig,
} from '../../config/bodyLimit.js';

function mockRes() {
  const res: Partial<Response> & {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = {
    headers: {},
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res as Response;
    },
    type(_t: string) {
      return res as Response;
    },
    setHeader(name: string, value: string | number) {
      res.headers[name.toLowerCase()] = String(value);
      return res as Response;
    },
    json(payload: unknown) {
      res.body = payload;
      return res as Response;
    },
  };
  return res;
}

describe('createBodyLimitMiddleware', () => {
  it('rejects oversize Content-Length with 413', () => {
    const mw = createBodyLimitMiddleware(100);
    const req = {
      headers: { 'content-length': '101' },
    } as unknown as RequestWithBodyLimit;
    const res = mockRes();
    const next = vi.fn();

    mw(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
    expect(res.headers['x-content-length-limit']).toBe('100');
    expect((res.body as { title: string }).title).toBe('Payload Too Large');
  });

  it('calls next when under limit and attaches metadata', () => {
    const mw = createBodyLimitMiddleware(1000);
    const req = {
      headers: { 'content-length': '50' },
    } as unknown as RequestWithBodyLimit;
    const res = mockRes();
    const next = vi.fn();

    mw(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.bodyLimitBytes).toBe(1000);
    expect(req.bodyLimitLabel).toBe('1000b');
  });

  it('throws when maxBytes is invalid', () => {
    expect(() => createBodyLimitMiddleware(0)).toThrow(/positive/);
    expect(() => createBodyLimitMiddleware(-1)).toThrow(/positive/);
  });
});

describe('createPathAwareBodyLimitMiddleware', () => {
  const config = loadBodyLimitConfig({});

  it('applies bulk limit on bulk path', () => {
    const mw = createPathAwareBodyLimitMiddleware(config);
    const req = {
      headers: {},
      originalUrl: '/api/credit/lines/bulk?dry_run=true',
      path: '/api/credit/lines/bulk',
    } as unknown as RequestWithBodyLimit;
    const next = vi.fn();

    mw(req as Request, mockRes() as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.bodyLimitBytes).toBe(BODY_LIMIT_BULK_BYTES);
  });

  it('applies default limit elsewhere', () => {
    const mw = createPathAwareBodyLimitMiddleware(config);
    const req = {
      headers: { 'content-length': String(BODY_LIMIT_DEFAULT_BYTES + 10) },
      originalUrl: '/api/risk/evaluate',
      path: '/api/risk/evaluate',
    } as unknown as RequestWithBodyLimit;
    const res = mockRes();
    const next = vi.fn();

    mw(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
    expect((res.body as { limit: number }).limit).toBe(BODY_LIMIT_DEFAULT_BYTES);
  });
});

describe('createJsonBodyLimitVerify', () => {
  it('throws PayloadTooLargeError when buffer exceeds path limit', () => {
    const config = loadBodyLimitConfig({});
    const verify = createJsonBodyLimitVerify(config);
    const req = {
      headers: {},
      originalUrl: '/api/risk/evaluate',
      path: '/api/risk/evaluate',
    } as unknown as RequestWithBodyLimit;
    const buf = Buffer.alloc(BODY_LIMIT_DEFAULT_BYTES + 1);

    expect(() => verify(req as Request, mockRes() as Response, buf)).toThrow(
      PayloadTooLargeError,
    );
  });

  it('allows buffers within the limit', () => {
    const config = loadBodyLimitConfig({});
    const verify = createJsonBodyLimitVerify(config);
    const req = {
      headers: {},
      originalUrl: '/api/credit/lines/bulk',
      path: '/api/credit/lines/bulk',
    } as unknown as RequestWithBodyLimit;
    const buf = Buffer.alloc(200 * 1024);

    expect(() => verify(req as Request, mockRes() as Response, buf)).not.toThrow();
    expect(req.rawBodyLength).toBe(200 * 1024);
    expect(req.bodyLimitBytes).toBe(BODY_LIMIT_BULK_BYTES);
  });
});

describe('isPayloadTooLargeError / respondPayloadTooLarge', () => {
  it('detects PayloadTooLargeError and body-parser shapes', () => {
    expect(isPayloadTooLargeError(new PayloadTooLargeError(10))).toBe(true);
    expect(isPayloadTooLargeError({ type: 'entity.too.large', status: 413 })).toBe(true);
    expect(isPayloadTooLargeError({ status: 413 })).toBe(true);
    expect(isPayloadTooLargeError(new Error('nope'))).toBe(false);
    expect(isPayloadTooLargeError(null)).toBe(false);
  });

  it('is a no-op when headers already sent', () => {
    const res = mockRes();
    res.headersSent = true;
    respondPayloadTooLarge(res as Response, 100);
    expect(res.statusCode).toBeUndefined();
  });
});
