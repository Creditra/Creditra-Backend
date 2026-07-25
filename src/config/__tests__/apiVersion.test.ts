import { describe, it, expect } from 'vitest';
import {
  API_VERSION,
  API_V1_PREFIX,
  DEFAULT_LEGACY_SUNSET,
  isLegacyApiPath,
  loadApiVersionPolicy,
  resolveApiVersionPolicy,
  resolveLegacySunset,
  toVersionedApiPath,
} from '../apiVersion.js';

describe('resolveLegacySunset', () => {
  it('returns default for empty or invalid values', () => {
    expect(resolveLegacySunset(undefined)).toBe(DEFAULT_LEGACY_SUNSET);
    expect(resolveLegacySunset('')).toBe(DEFAULT_LEGACY_SUNSET);
    expect(resolveLegacySunset('not-a-date')).toBe(DEFAULT_LEGACY_SUNSET);
  });

  it('normalises a valid HTTP-date to UTC string', () => {
    const result = resolveLegacySunset('Thu, 31 Dec 2026 23:59:59 GMT');
    expect(Date.parse(result)).not.toBeNaN();
    expect(result).toContain('2026');
  });
});

describe('loadApiVersionPolicy', () => {
  it('reads API_LEGACY_SUNSET from env', () => {
    const { legacySunset } = loadApiVersionPolicy({
      API_LEGACY_SUNSET: 'Fri, 01 Jan 2027 00:00:00 GMT',
    });
    expect(legacySunset).toContain('2027');
  });

  it('falls back to default when unset', () => {
    const { legacySunset } = loadApiVersionPolicy({});
    expect(legacySunset).toBe(DEFAULT_LEGACY_SUNSET);
  });
});

describe('isLegacyApiPath', () => {
  it('detects unversioned /api paths', () => {
    expect(isLegacyApiPath('/api/credit/lines')).toBe(true);
    expect(isLegacyApiPath('/api/risk/evaluate')).toBe(true);
    expect(isLegacyApiPath('/api')).toBe(true);
  });

  it('excludes versioned and non-api paths', () => {
    expect(isLegacyApiPath('/api/v1/credit/lines')).toBe(false);
    expect(isLegacyApiPath('/api/v1')).toBe(false);
    expect(isLegacyApiPath('/health')).toBe(false);
    expect(isLegacyApiPath('/docs')).toBe(false);
    expect(isLegacyApiPath('/api-keys')).toBe(false);
  });
});

describe('toVersionedApiPath', () => {
  it('maps /api/... to /api/v1/...', () => {
    expect(toVersionedApiPath('/api/credit/lines')).toBe(
      `${API_V1_PREFIX}/credit/lines`,
    );
    expect(toVersionedApiPath('/api/risk/evaluate?x=1')).toBe(
      `${API_V1_PREFIX}/risk/evaluate?x=1`,
    );
    expect(toVersionedApiPath('/api')).toBe(API_V1_PREFIX);
  });

  it('leaves versioned and non-api paths unchanged', () => {
    expect(toVersionedApiPath('/api/v1/credit/lines')).toBe(
      '/api/v1/credit/lines',
    );
    expect(toVersionedApiPath('/health')).toBe('/health');
  });
});

describe('resolveApiVersionPolicy', () => {
  it('marks v1 paths as current', () => {
    const policy = resolveApiVersionPolicy('/api/v1/credit/lines');
    expect(policy).toEqual({
      version: API_VERSION,
      deprecated: false,
      sunset: null,
    });
  });

  it('marks legacy paths as deprecated with sunset', () => {
    const sunset = 'Thu, 31 Dec 2026 23:59:59 GMT';
    const policy = resolveApiVersionPolicy('/api/credit/lines', {
      legacySunset: sunset,
    });
    expect(policy).toEqual({
      version: API_VERSION,
      deprecated: true,
      sunset,
    });
  });

  it('returns null for non-api paths', () => {
    expect(resolveApiVersionPolicy('/health')).toBeNull();
    expect(resolveApiVersionPolicy('/docs.json')).toBeNull();
  });
});
