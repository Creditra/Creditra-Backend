/**
 * Shared optimistic-concurrency policy for credit-line writes.
 *
 * The repository is the authority that performs the compare-and-set. This
 * module keeps parsing, safe error details, and client retry guidance uniform
 * across the HTTP service, memory repository, and PostgreSQL repository.
 */

export const INITIAL_CREDIT_LINE_VERSION = 1;
export const DEFAULT_RETRY_BASE_MS = 25;
export const DEFAULT_RETRY_MAX_MS = 2_000;
export const DEFAULT_RETRY_ATTEMPTS = 3;

export type VersionInput = number | string;

export interface VersionConflictDetails {
  expectedVersion: number;
  actualVersion: number;
  retryable: true;
  retryWithVersion: number;
}

/**
 * Public 400 error used when a service boundary receives a malformed version.
 * It intentionally contains no record id or database information.
 */
export class InvalidExpectedVersionError extends Error {
  readonly code = 'invalid_expected_version';
  readonly statusCode = 400;

  constructor() {
    super('expectedVersion must be a positive integer.');
    this.name = 'InvalidExpectedVersionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Domain error raised when compare-and-set loses a write race. */
export class VersionConflictError extends Error {
  readonly code = 'version_conflict';
  readonly statusCode = 409;

  constructor(
    public readonly id: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Credit line was modified concurrently (expected version ${expectedVersion}, ` +
        `found ${actualVersion}). ${retryGuidance(actualVersion)}`,
    );
    this.name = 'VersionConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Convert an untrusted request value into the only version representation we store. */
export function normalizeExpectedVersion(value: unknown): number {
  if (typeof value === 'string' && value.trim() === '') {
    throw new InvalidExpectedVersionError();
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < INITIAL_CREDIT_LINE_VERSION) {
    throw new InvalidExpectedVersionError();
  }
  return numeric;
}

/** Normalize rows created before the version column was introduced. */
export function storedVersion(version: number | null | undefined): number {
  if (version === undefined || version === null) return INITIAL_CREDIT_LINE_VERSION;
  return normalizeExpectedVersion(version);
}

/** Produce safe, machine-readable details for a 409 response. */
export function versionConflictDetails(
  expectedVersion: VersionInput,
  actualVersion: VersionInput,
): VersionConflictDetails {
  const expected = normalizeExpectedVersion(expectedVersion);
  const actual = normalizeExpectedVersion(actualVersion);
  return {
    expectedVersion: expected,
    actualVersion: actual,
    retryable: true,
    retryWithVersion: actual,
  };
}

/** Check a version without mutating a record or throwing an HTTP-shaped error. */
export function matchesVersion(
  actualVersion: VersionInput,
  expectedVersion: VersionInput,
): boolean {
  return normalizeExpectedVersion(actualVersion) === normalizeExpectedVersion(expectedVersion);
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

export interface RetryDelayOptions {
  attempt: number;
  policy?: Partial<RetryPolicy>;
  random?: () => number;
}

export interface RetryDecision {
  attempt: number;
  retry: boolean;
  delayMs: number;
  reason: 'version_conflict' | 'attempt_limit';
}

/**
 * Return a bounded backoff decision for a caller that has re-read the row.
 * A conflict must never be retried against the same stale version; the caller
 * is responsible for applying `retryWithVersion` before the next attempt.
 */
export function versionRetryDecision(options: RetryDelayOptions): RetryDecision {
  const policy: RetryPolicy = {
    maxAttempts: options.policy?.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs: options.policy?.baseDelayMs ?? DEFAULT_RETRY_BASE_MS,
    maxDelayMs: options.policy?.maxDelayMs ?? DEFAULT_RETRY_MAX_MS,
    jitterMs: options.policy?.jitterMs ?? 0,
  };

  if (!Number.isSafeInteger(options.attempt) || options.attempt < 1) {
    throw new RangeError('attempt must be a positive integer');
  }
  if (policy.maxAttempts < 1 || policy.baseDelayMs < 0 || policy.maxDelayMs < 0) {
    throw new RangeError('retry policy values must be non-negative and usable');
  }

  const retry = options.attempt < policy.maxAttempts;
  if (!retry) {
    return { attempt: options.attempt, retry: false, delayMs: 0, reason: 'attempt_limit' };
  }

  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (options.attempt - 1),
  );
  const random = options.random?.() ?? 0;
  const jitter = Math.min(policy.jitterMs, Math.max(0, random) * policy.jitterMs);
  return {
    attempt: options.attempt,
    retry: true,
    delayMs: Math.min(policy.maxDelayMs, Math.round(exponential + jitter)),
    reason: 'version_conflict',
  };
}

export interface CompareAndSetResult<T> {
  updated: boolean;
  value: T;
  version: number;
}

/**
 * Small pure helper used by the in-memory repository and unit tests to model
 * the database's atomic `WHERE version = expected` behavior.
 */
export function compareAndSet<T>(
  current: { value: T; version: number },
  expectedVersion: VersionInput,
  next: (value: T) => T,
): CompareAndSetResult<T> {
  const expected = normalizeExpectedVersion(expectedVersion);
  const actual = storedVersion(current.version);
  if (actual !== expected) {
    return { updated: false, value: current.value, version: actual };
  }
  return { updated: true, value: next(current.value), version: actual + 1 };
}

export interface VersionedMutation<TRequest> {
  request: TRequest;
  expectedVersion: number;
}

/** Convert a parsed API body into an explicit mutation command. */
export function versionedMutation<TRequest extends { expectedVersion: unknown }>(
  request: TRequest,
): VersionedMutation<Omit<TRequest, 'expectedVersion'>> {
  const { expectedVersion, ...mutation } = request;
  return {
    request: mutation,
    expectedVersion: normalizeExpectedVersion(expectedVersion),
  };
}

/** Stable text for SDKs that want to show a retry action without parsing prose. */
export function retryGuidance(actualVersion: VersionInput): string {
  const actual = normalizeExpectedVersion(actualVersion);
  return `Re-read the credit line and retry with expectedVersion ${actual}.`;
}
