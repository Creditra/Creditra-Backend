import { describe, it, expect } from 'vitest';
import { clamp, isFiniteInteger, parsePositiveInt } from '../numbers.js';

describe('numbers utils', () => {
    describe('clamp', () => {
        it('returns the value when within range', () => {
            expect(clamp(5, 0, 10)).toBe(5);
        });

        it('clamps below the min', () => {
            expect(clamp(-1, 0, 10)).toBe(0);
        });

        it('clamps above the max', () => {
            expect(clamp(11, 0, 10)).toBe(10);
        });

        it('returns min when value is NaN', () => {
            expect(clamp(Number.NaN, 0, 10)).toBe(0);
        });

        it('collapses to min when range is degenerate', () => {
            expect(clamp(5, 10, 0)).toBe(10);
        });
    });

    describe('isFiniteInteger', () => {
        it('accepts integers', () => {
            expect(isFiniteInteger(0)).toBe(true);
            expect(isFiniteInteger(-3)).toBe(true);
        });

        it('rejects floats and non-numbers', () => {
            expect(isFiniteInteger(1.5)).toBe(false);
            expect(isFiniteInteger('5')).toBe(false);
            expect(isFiniteInteger(Number.NaN)).toBe(false);
            expect(isFiniteInteger(Infinity)).toBe(false);
        });
    });

    describe('parsePositiveInt', () => {
        it('parses positive base-10 integers', () => {
            expect(parsePositiveInt('25')).toBe(25);
        });

        it('rejects zero, negatives, and decimals', () => {
            expect(parsePositiveInt('0')).toBe(null);
            expect(parsePositiveInt('-1')).toBe(null);
            expect(parsePositiveInt('1.5')).toBe(null);
        });

        it('rejects non-digit input', () => {
            expect(parsePositiveInt('abc')).toBe(null);
            expect(parsePositiveInt('')).toBe(null);
            expect(parsePositiveInt(undefined)).toBe(null);
            expect(parsePositiveInt(null)).toBe(null);
        });
    });
});
