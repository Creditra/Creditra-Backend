import { describe, expect, it } from 'vitest';
import {
  INITIAL_CREDIT_LINE_VERSION,
  InvalidExpectedVersionError,
  compareAndSet,
  matchesVersion,
  normalizeExpectedVersion,
  retryGuidance,
  storedVersion,
  versionConflictDetails,
  versionRetryDecision,
  versionedMutation,
} from './creditLineConcurrency.js';

describe('credit-line version policy', () => {
  it('uses one as the first persisted version', () => {
    expect(INITIAL_CREDIT_LINE_VERSION).toBe(1);
    expect(storedVersion(undefined)).toBe(1);
    expect(storedVersion(null)).toBe(1);
  });

  it.each([1, 2, 999, '1', ' 2 '])('normalizes %s', (value) => {
    expect(normalizeExpectedVersion(value)).toBe(Number(value));
  });

  it.each([undefined, null, '', '   ', 0, -1, 1.5, '1.5', Number.MAX_SAFE_INTEGER + 1, 'nope'])
    ('rejects malformed version %s', (value) => {
      expect(() => normalizeExpectedVersion(value)).toThrow(InvalidExpectedVersionError);
    });

  it('does not treat a string version as a different version', () => {
    expect(matchesVersion(4, '4')).toBe(true);
    expect(matchesVersion(4, 5)).toBe(false);
  });

  it('creates safe retryable conflict details', () => {
    expect(versionConflictDetails('2', 3)).toEqual({
      expectedVersion: 2,
      actualVersion: 3,
      retryable: true,
      retryWithVersion: 3,
    });
  });

  it('does not include an id or storage detail in retry guidance', () => {
    expect(retryGuidance(8)).toBe('Re-read the credit line and retry with expectedVersion 8.');
  });

  it('accepts the first attempt with the default policy', () => {
    expect(versionRetryDecision({ attempt: 1 })).toEqual({
      attempt: 1,
      retry: true,
      delayMs: 25,
      reason: 'version_conflict',
    });
  });

  it('doubles bounded backoff between attempts', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 50 };
    expect(versionRetryDecision({ attempt: 1, policy }).delayMs).toBe(10);
    expect(versionRetryDecision({ attempt: 2, policy }).delayMs).toBe(20);
    expect(versionRetryDecision({ attempt: 3, policy }).delayMs).toBe(40);
    expect(versionRetryDecision({ attempt: 4, policy }).delayMs).toBe(50);
  });

  it('stops after the configured attempt count', () => {
    expect(versionRetryDecision({ attempt: 3, policy: { maxAttempts: 3 } })).toEqual({
      attempt: 3,
      retry: false,
      delayMs: 0,
      reason: 'attempt_limit',
    });
  });

  it('caps jitter and delay at the configured maximum', () => {
    expect(versionRetryDecision({
      attempt: 2,
      policy: { baseDelayMs: 100, maxDelayMs: 120, jitterMs: 100 },
      random: () => 1,
    }).delayMs).toBe(120);
  });

  it.each([0, -1, 1.2])('rejects invalid attempt %s', (attempt) => {
    expect(() => versionRetryDecision({ attempt })).toThrow(RangeError);
  });

  it('models an atomic compare-and-set success', () => {
    const current = { value: { interestRateBps: 500 }, version: 1 };
    const result = compareAndSet(current, 1, (value) => ({ ...value, interestRateBps: 600 }));
    expect(result).toEqual({ updated: true, value: { interestRateBps: 600 }, version: 2 });
    expect(current).toEqual({ value: { interestRateBps: 500 }, version: 1 });
  });

  it('models a stale compare-and-set without applying the callback', () => {
    let called = false;
    const result = compareAndSet({ value: 'current', version: 4 }, 3, () => {
      called = true;
      return 'must not be stored';
    });
    expect(result).toEqual({ updated: false, value: 'current', version: 4 });
    expect(called).toBe(false);
  });

  it('turns an API body into a versioned mutation command', () => {
    expect(versionedMutation({ status: 'suspended', expectedVersion: '9' })).toEqual({
      request: { status: 'suspended' },
      expectedVersion: 9,
    });
  });

  it('rejects a versioned mutation with a blank version', () => {
    expect(() => versionedMutation({ status: 'suspended', expectedVersion: ' ' }))
      .toThrow('expectedVersion must be a positive integer');
  });
});
