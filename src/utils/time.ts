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
