/**
 * Small object/record helpers.
 *
 * Kept dependency-free so they can be imported from any layer without
 * incurring transitive runtime imports.
 */

/**
 * Returns a new object containing only the listed keys from the source.
 * Missing keys are simply omitted from the result.
 */
export const pick = <T extends Record<string, unknown>, K extends keyof T>(
    source: T,
    keys: readonly K[],
): Pick<T, K> => {
    const out = {} as Pick<T, K>;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            out[key] = source[key];
        }
    }
    return out;
};

/**
 * Returns a new object excluding the listed keys from the source.
 */
export const omit = <T extends Record<string, unknown>, K extends keyof T>(
    source: T,
    keys: readonly K[],
): Omit<T, K> => {
    const drop = new Set(keys as readonly (keyof T)[]);
    const out = {} as Record<string, unknown>;
    for (const key of Object.keys(source)) {
        if (!drop.has(key as keyof T)) {
            out[key] = source[key];
        }
    }
    return out as Omit<T, K>;
};

/**
 * Returns `true` when the value is a plain object (not an array, not null,
 * and not a class instance with a custom prototype).
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};
