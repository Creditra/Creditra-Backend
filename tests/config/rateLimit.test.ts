import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadRateLimitConfig } from '../../src/config/rateLimit.js';

describe('loadRateLimitConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default values when no env vars are set', () => {
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_MAX_EVALUATE;

    const config = loadRateLimitConfig();

    expect(config.default.windowMs).toBe(60_000);
    expect(config.default.maxRequests).toBe(100);
    expect(config.evaluate.windowMs).toBe(60_000);
    expect(config.evaluate.maxRequests).toBe(10);
  });

  it('applies custom window and max requests', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '30000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '50';
    process.env.RATE_LIMIT_MAX_EVALUATE = '5';

    const config = loadRateLimitConfig();

    expect(config.default.windowMs).toBe(30_000);
    expect(config.default.maxRequests).toBe(50);
    expect(config.evaluate.windowMs).toBe(30_000);
    expect(config.evaluate.maxRequests).toBe(5);
  });

  it('uses default values for invalid env var entries', () => {
    process.env.RATE_LIMIT_WINDOW_MS = 'not-a-number';
    process.env.RATE_LIMIT_MAX_REQUESTS = '0';
    process.env.RATE_LIMIT_MAX_EVALUATE = '-5';

    const config = loadRateLimitConfig();

    expect(config.default.windowMs).toBe(60_000);
    expect(config.default.maxRequests).toBe(100);
    expect(config.evaluate.maxRequests).toBe(10);
  });

  it('treats non-numeric strings as invalid and uses defaults', () => {
    process.env.RATE_LIMIT_WINDOW_MS = 'abc';
    process.env.RATE_LIMIT_MAX_REQUESTS = '';
    process.env.RATE_LIMIT_MAX_EVALUATE = '   ';

    const config = loadRateLimitConfig();

    expect(config.default.windowMs).toBe(60_000);
    expect(config.default.maxRequests).toBe(100);
    expect(config.evaluate.maxRequests).toBe(10);
  });
});
