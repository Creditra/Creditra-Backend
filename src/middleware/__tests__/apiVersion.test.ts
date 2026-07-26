import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  applyApiVersionHeaders,
  createApiVersionMiddleware,
  createLegacyDeprecationMiddleware,
  createV1VersionMiddleware,
  DEPRECATION_HEADER,
  LINK_HEADER,
  SUNSET_HEADER,
  X_API_VERSION_HEADER,
} from '../apiVersion.js';
import { API_VERSION, DEFAULT_LEGACY_SUNSET } from '../../config/apiVersion.js';

function mockRes() {
  const headers: Record<string, string> = {};
  const res: Partial<Response> = {
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = String(value);
      return res as Response;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
  };
  return { res: res as Response, headers };
}

describe('applyApiVersionHeaders', () => {
  it('sets only X-API-Version for non-deprecated policy', () => {
    const { res, headers } = mockRes();
    applyApiVersionHeaders(
      res,
      { version: '1', deprecated: false, sunset: null },
      '/api/v1/credit/lines',
    );
    expect(headers['x-api-version']).toBe('1');
    expect(headers['deprecation']).toBeUndefined();
    expect(headers['sunset']).toBeUndefined();
    expect(headers['link']).toBeUndefined();
  });

  it('sets Deprecation, Sunset, and successor Link for legacy', () => {
    const { res, headers } = mockRes();
    applyApiVersionHeaders(
      res,
      {
        version: '1',
        deprecated: true,
        sunset: DEFAULT_LEGACY_SUNSET,
      },
      '/api/credit/lines',
    );
    expect(headers['x-api-version']).toBe('1');
    expect(headers['deprecation']).toBe('true');
    expect(headers['sunset']).toBe(DEFAULT_LEGACY_SUNSET);
    expect(headers['link']).toBe(
      '</api/v1/credit/lines>; rel="successor-version"',
    );
  });

  it('appends to an existing Link header', () => {
    const { res, headers } = mockRes();
    headers['link'] = '</docs>; rel="service-doc"';
    applyApiVersionHeaders(
      res,
      { version: '1', deprecated: true, sunset: DEFAULT_LEGACY_SUNSET },
      '/api/risk/evaluate',
    );
    expect(headers['link']).toContain('rel="service-doc"');
    expect(headers['link']).toContain(
      '</api/v1/risk/evaluate>; rel="successor-version"',
    );
  });
});

describe('createV1VersionMiddleware', () => {
  it('sets X-API-Version and calls next', () => {
    const mw = createV1VersionMiddleware();
    const { res, headers } = mockRes();
    const next = vi.fn();
    mw({} as Request, res, next as NextFunction);
    expect(headers['x-api-version']).toBe(API_VERSION);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('createLegacyDeprecationMiddleware', () => {
  it('stamps deprecation headers from originalUrl', () => {
    const mw = createLegacyDeprecationMiddleware({
      legacySunset: DEFAULT_LEGACY_SUNSET,
    });
    const { res, headers } = mockRes();
    const next = vi.fn();
    const req = {
      originalUrl: '/api/webhooks/health?x=1',
      url: '/webhooks/health?x=1',
      path: '/webhooks/health',
    } as unknown as Request;

    mw(req, res, next as NextFunction);

    expect(headers[X_API_VERSION_HEADER.toLowerCase()]).toBe('1');
    expect(headers[DEPRECATION_HEADER.toLowerCase()]).toBe('true');
    expect(headers[SUNSET_HEADER.toLowerCase()]).toBe(DEFAULT_LEGACY_SUNSET);
    expect(headers[LINK_HEADER.toLowerCase()]).toBe(
      '</api/v1/webhooks/health>; rel="successor-version"',
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('createApiVersionMiddleware', () => {
  it('versions v1 paths without deprecation', () => {
    const mw = createApiVersionMiddleware();
    const { res, headers } = mockRes();
    const next = vi.fn();
    mw(
      { originalUrl: '/api/v1/credit/lines' } as Request,
      res,
      next as NextFunction,
    );
    expect(headers['x-api-version']).toBe('1');
    expect(headers['deprecation']).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('deprecates legacy paths', () => {
    const mw = createApiVersionMiddleware({
      legacySunset: DEFAULT_LEGACY_SUNSET,
    });
    const { res, headers } = mockRes();
    const next = vi.fn();
    mw(
      { originalUrl: '/api/credit/lines' } as Request,
      res,
      next as NextFunction,
    );
    expect(headers['deprecation']).toBe('true');
    expect(headers['sunset']).toBe(DEFAULT_LEGACY_SUNSET);
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips non-api paths', () => {
    const mw = createApiVersionMiddleware();
    const { res, headers } = mockRes();
    const next = vi.fn();
    mw({ originalUrl: '/health' } as Request, res, next as NextFunction);
    expect(headers['x-api-version']).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
