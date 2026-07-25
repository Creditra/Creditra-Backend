import { describe, it, expect } from 'vitest';
import {
  BODY_LIMIT_BULK_BYTES,
  BODY_LIMIT_DEFAULT_BYTES,
  bodyTooLargeMessage,
  formatBodyLimitLabel,
  loadBodyLimitConfig,
  resolveBodyLimit,
} from '../bodyLimit.js';

describe('loadBodyLimitConfig', () => {
  it('returns secure defaults', () => {
    const config = loadBodyLimitConfig({});
    expect(config.defaultMaxBytes).toBe(100 * 1024);
    expect(config.defaultMaxBytes).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(config.routes).toEqual([
      expect.objectContaining({
        pathPrefix: '/api/credit/lines/bulk',
        maxBytes: BODY_LIMIT_BULK_BYTES,
      }),
    ]);
    expect(config.maxBytes).toBe(BODY_LIMIT_BULK_BYTES);
  });

  it('ignores non-positive env values', () => {
    const config = loadBodyLimitConfig({
      BODY_LIMIT_DEFAULT_BYTES: '0',
      BODY_LIMIT_BULK_BYTES: '-1',
      BODY_LIMIT_MAX_BYTES: 'nope',
    });
    expect(config.defaultMaxBytes).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(config.routes[0]?.maxBytes).toBe(BODY_LIMIT_BULK_BYTES);
  });
});

describe('resolveBodyLimit', () => {
  const config = loadBodyLimitConfig({});

  it('uses default for ordinary API paths', () => {
    expect(resolveBodyLimit('/api/credit/lines', config)).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(resolveBodyLimit('/api/risk/evaluate', config)).toBe(BODY_LIMIT_DEFAULT_BYTES);
    expect(resolveBodyLimit('/health', config)).toBe(BODY_LIMIT_DEFAULT_BYTES);
  });

  it('uses bulk limit for bulk prefix and subpaths only', () => {
    expect(resolveBodyLimit('/api/credit/lines/bulk', config)).toBe(BODY_LIMIT_BULK_BYTES);
    expect(resolveBodyLimit('/api/credit/lines/bulk/', config)).toBe(BODY_LIMIT_BULK_BYTES);
    expect(resolveBodyLimit('/api/credit/lines/bulk?dry_run=true', config)).toBe(
      BODY_LIMIT_BULK_BYTES,
    );
    expect(resolveBodyLimit('/api/credit/lines/bulkish', config)).toBe(
      BODY_LIMIT_DEFAULT_BYTES,
    );
  });
});

describe('formatBodyLimitLabel / bodyTooLargeMessage', () => {
  it('formats whole kib/mib counts compactly', () => {
    expect(formatBodyLimitLabel(1024)).toBe('1kb');
    expect(formatBodyLimitLabel(100 * 1024)).toBe('100kb');
    expect(formatBodyLimitLabel(1024 * 1024)).toBe('1mb');
  });

  it('formats odd sizes with one decimal', () => {
    expect(formatBodyLimitLabel(1536)).toBe('1.5kb');
    expect(formatBodyLimitLabel(100)).toBe('100b');
  });

  it('builds a clear client message', () => {
    const msg = bodyTooLargeMessage(BODY_LIMIT_DEFAULT_BYTES);
    expect(msg).toMatch(/Payload Too Large/i);
    expect(msg).toContain('100kb');
  });
});
