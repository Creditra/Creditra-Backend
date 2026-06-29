/**
 * Money formatting helpers.
 *
 * Money-like values are represented in API responses as a structured object
 * rather than a bare number to remove client-side ambiguity around precision
 * and currency. The canonical, lossless source of truth is `minorUnits` (an
 * integer string in the currency's smallest unit, e.g. cents/stroops). A
 * human-readable `amount` decimal string is provided for convenience.
 *
 * Kept small, dependency-free, and pure so it can be imported from any layer.
 */

export interface MoneyResponse {
    /** Lossless integer amount in the currency's minor units, as a string. */
    minorUnits: string;
    /** Human-readable decimal string, e.g. "1234.56". */
    amount: string;
    /** ISO-4217-style currency code, upper-cased. */
    currency: string;
    /** Number of fractional digits used to derive `amount` from `minorUnits`. */
    decimals: number;
}

const MAX_DECIMALS = 18;

/**
 * Formats an integer minor-units value into the canonical money response.
 *
 * @param minorUnits integer value in minor units (number, bigint or digit string)
 * @param currency   currency code (defaults to "USD")
 * @param decimals   fractional digits for the currency (defaults to 2)
 */
export const formatMoney = (
    minorUnits: number | bigint | string,
    currency = 'USD',
    decimals = 2,
): MoneyResponse => {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
        throw new RangeError(`decimals must be an integer in [0, ${MAX_DECIMALS}]`);
    }

    const big = toBigInt(minorUnits);
    const negative = big < 0n;
    const digits = (negative ? -big : big).toString().padStart(decimals + 1, '0');

    const whole = digits.slice(0, digits.length - decimals);
    const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : '';
    const amount = `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;

    return {
        minorUnits: big.toString(),
        amount,
        currency: currency.toUpperCase(),
        decimals,
    };
};

/**
 * Parses a value into a bigint of minor units, rejecting anything that is not a
 * base-10 integer. Floats are rejected because they cannot represent money
 * losslessly.
 */
const toBigInt = (value: number | bigint | string): bigint => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new TypeError('minorUnits number must be an integer');
        }
        return BigInt(value);
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        return BigInt(value);
    }
    throw new TypeError(`invalid minorUnits value: ${String(value)}`);
};
