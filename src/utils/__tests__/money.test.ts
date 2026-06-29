import { describe, it, expect } from 'vitest';
import { formatMoney } from '../money.js';

describe('money utils', () => {
    describe('formatMoney', () => {
        it('formats whole minor units into a 2-decimal amount', () => {
            expect(formatMoney(123456)).toEqual({
                minorUnits: '123456',
                amount: '1234.56',
                currency: 'USD',
                decimals: 2,
            });
        });

        it('pads fractional digits when the value is small', () => {
            expect(formatMoney(5).amount).toBe('0.05');
            expect(formatMoney(0).amount).toBe('0.00');
        });

        it('handles negative amounts', () => {
            expect(formatMoney(-99).amount).toBe('-0.99');
            expect(formatMoney(-123456).amount).toBe('-1234.56');
        });

        it('upper-cases the currency code', () => {
            expect(formatMoney(100, 'usd').currency).toBe('USD');
        });

        it('supports zero-decimal and high-precision currencies', () => {
            expect(formatMoney(1500, 'JPY', 0).amount).toBe('1500');
            expect(formatMoney('10000000', 'XLM', 7).amount).toBe('1.0000000');
        });

        it('accepts string and bigint minor units losslessly', () => {
            expect(formatMoney('900719925474099100').minorUnits).toBe('900719925474099100');
            expect(formatMoney(900719925474099100n).amount).toBe('9007199254740991.00');
        });

        it('rejects non-integer numbers and malformed strings', () => {
            expect(() => formatMoney(12.34)).toThrow(TypeError);
            expect(() => formatMoney('12.34')).toThrow(TypeError);
            expect(() => formatMoney('abc')).toThrow(TypeError);
        });

        it('rejects out-of-range decimals', () => {
            expect(() => formatMoney(100, 'USD', -1)).toThrow(RangeError);
            expect(() => formatMoney(100, 'USD', 19)).toThrow(RangeError);
        });
    });
});
