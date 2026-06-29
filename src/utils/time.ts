/**
 * Common time-related constants and helpers.
 *
 * Centralised to avoid scattering raw millisecond literals across the
 * codebase. All durations are expressed in milliseconds unless stated
 * otherwise.
 */

export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * Intended for retry/backoff loops and tests; not for production hot paths.
 */
export const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
};

/**
 * Returns the current epoch time in seconds. Useful when integrating with
 * APIs (such as Stellar) that use second-resolution timestamps.
 */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// UTC-only time handling
// ---------------------------------------------------------------------------
//
// The backend standardises on UTC for every persisted, logged, and API-facing
// timestamp. Server-derived timestamps come from `nowUtcIso()`; chain-derived
// timestamps (e.g. Horizon `created_at`, ledger close time) are already UTC
// and are normalised through `toUtcIso()`. Never format timestamps with
// locale-aware helpers (`toLocaleString`, `toDateString`, …) — they introduce
// time-zone drift that breaks reconciliation and audits. See `docs/time.md`.

/**
 * ISO-8601 UTC timestamp with millisecond precision and a `Z` suffix, e.g.
 * `2026-06-29T12:34:56.789Z`. `Date.prototype.toISOString()` is always UTC,
 * so this is the canonical, time-zone-stable representation.
 */
export const toUtcIso = (date: Date): string => date.toISOString();

/**
 * The current instant as a UTC ISO-8601 string. Prefer this over
 * `new Date().toString()` or any locale-aware formatter for server-derived
 * timestamps.
 */
export const nowUtcIso = (): string => new Date().toISOString();

/**
 * Parse a timestamp into a `Date`, treating the value as UTC. Accepts an
 * ISO-8601 string or an epoch-millisecond number. Returns `null` for invalid
 * input so callers can fail explicitly rather than propagate `Invalid Date`.
 *
 * A date-only string (`YYYY-MM-DD`) and an offset-less date-time are both
 * interpreted as UTC per the ECMAScript spec, avoiding the "parsed in local
 * time" footgun.
 */
export const parseUtc = (value: string | number): Date | null => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * True when `value` is a UTC ISO-8601 string (ends in `Z` and round-trips
 * through `Date`). Useful for asserting that timestamps crossing a boundary
 * (API response, persisted column) carry no local-time offset.
 */
export const isUtcIso = (value: string): boolean => {
    if (!value.endsWith('Z')) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};
