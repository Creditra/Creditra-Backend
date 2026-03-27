import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';

import { isAllowedCorsOrigin, loadCorsPolicy } from '../src/config/cors.js';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
};

function restoreEnv(): void {
  if (originalEnv.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
  }

  if (originalEnv.CORS_ORIGINS === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = originalEnv.CORS_ORIGINS;
  }
}

describe('CORS policy helper', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('allows requests without an Origin header', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const policy = loadCorsPolicy();

    expect(isAllowedCorsOrigin(undefined, policy)).toBe(true);
  });

  it('falls back to loopback origins when CORS_ORIGINS is unset outside production', () => {
    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = 'test';

    const policy = loadCorsPolicy();

    expect(isAllowedCorsOrigin('http://localhost:5173', policy)).toBe(true);
    expect(isAllowedCorsOrigin('http://127.0.0.1:3000', policy)).toBe(true);
    expect(isAllowedCorsOrigin('http://[::1]:4200', policy)).toBe(true);
    expect(isAllowedCorsOrigin('https://example.com', policy)).toBe(false);
  });

  it('parses, normalizes, and deduplicates an explicit allowlist', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.com, https://admin.example.com/, https://app.example.com';

    const policy = loadCorsPolicy();

    expect(policy.kind).toBe('allowlist');
    if (policy.kind === 'allowlist') {
      expect(policy.origins.size).toBe(2);
      expect(policy.origins.has('https://app.example.com')).toBe(true);
      expect(policy.origins.has('https://admin.example.com')).toBe(true);
      expect(isAllowedCorsOrigin('https://app.example.com', policy)).toBe(true);
      expect(isAllowedCorsOrigin('https://evil.example.com', policy)).toBe(false);
    }
  });

  it('rejects invalid allowlist entries that use unsupported protocols', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'ftp://example.com';

    expect(() => loadCorsPolicy()).toThrow(/Only http and https origins/);
  });

  it('rejects allowlist entries that include a path or credentials', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'https://user:pass@example.com';

    expect(() => loadCorsPolicy()).toThrow(/Credentials are not allowed/);
  });

  it('rejects allowlist entries that include a path', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'https://app.example.com/path';

    expect(() => loadCorsPolicy()).toThrow(/exact origin only/);
  });

  it('throws when CORS_ORIGINS is present but empty', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = '   ';

    expect(() => loadCorsPolicy()).toThrow(/CORS_ORIGINS/);
  });

  it('rejects non-loopback origins in loopback mode', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.CORS_ORIGINS;

    const policy = loadCorsPolicy();

    expect(isAllowedCorsOrigin('ftp://localhost', policy)).toBe(false);
    expect(isAllowedCorsOrigin('not-a-url', policy)).toBe(false);
  });

  it('throws in production when CORS_ORIGINS is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;

    expect(() => loadCorsPolicy()).toThrow(/CORS_ORIGINS/);
  });
});

describe('application CORS behavior', () => {
  let app: Application;

  beforeAll(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    delete process.env.CORS_ORIGINS;

    ({ app } = await import('../src/index.js'));
  });

  afterAll(() => {
    restoreEnv();
  });

  it('echoes localhost origins on preflight requests', async () => {
    const response = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('omits CORS headers for disallowed browser origins', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});