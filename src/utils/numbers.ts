/**
 * Numeric helpers used across the codebase.
 *
 * Kept small, dependency-free, and pure so they can be safely imported
 * from any layer.
 */

/**
 * Clamps a number to the inclusive `[min, max]` range. When `min > max`,
 * the value is clamped to `min` (degenerate ranges collapse to the lower
 * bound).
 */
export const clamp = (value: number, min: number, max: number): number => {
    if (Number.isNaN(value)) return min;
    if (min > max) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

/**
 * Returns `true` when the value is a finite integer.
 */
export const isFiniteInteger = (value: unknown): value is number => {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
};

/**
 * Parses a string into a positive integer, returning `null` on failure.
 * Accepts only base-10 digits; rejects leading signs and decimals.
 */
export const parsePositiveInt = (input: string | undefined | null): number | null => {
    if (typeof input !== 'string') return null;
    if (!/^[0-9]+$/.test(input)) return null;
    const parsed = Number.parseInt(input, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
};
