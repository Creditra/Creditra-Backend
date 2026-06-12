import { describe, it, expect } from 'vitest';
import { pick, omit, isPlainObject } from '../objects.js';

describe('objects utils', () => {
    describe('pick', () => {
        it('returns only the requested keys', () => {
            const source = { a: 1, b: 2, c: 3 };
            expect(pick(source, ['a', 'c'])).toEqual({ a: 1, c: 3 });
        });

        it('omits missing keys silently', () => {
            const source = { a: 1 } as Record<string, unknown>;
            expect(pick(source, ['a', 'b'])).toEqual({ a: 1 });
        });

        it('returns an empty object when no keys are requested', () => {
            expect(pick({ a: 1, b: 2 }, [])).toEqual({});
        });
    });

    describe('omit', () => {
        it('drops the listed keys', () => {
            const source = { a: 1, b: 2, c: 3 };
            expect(omit(source, ['b'])).toEqual({ a: 1, c: 3 });
        });

        it('returns a shallow copy when no keys are dropped', () => {
            const source = { a: 1 };
            const result = omit(source, [] as (keyof typeof source)[]);
            expect(result).toEqual({ a: 1 });
            expect(result).not.toBe(source);
        });
    });

    describe('isPlainObject', () => {
        it('accepts object literals', () => {
            expect(isPlainObject({})).toBe(true);
            expect(isPlainObject({ a: 1 })).toBe(true);
        });

        it('accepts objects with a null prototype', () => {
            expect(isPlainObject(Object.create(null))).toBe(true);
        });

        it('rejects arrays, null, and primitives', () => {
            expect(isPlainObject([])).toBe(false);
            expect(isPlainObject(null)).toBe(false);
            expect(isPlainObject(undefined)).toBe(false);
            expect(isPlainObject('s')).toBe(false);
            expect(isPlainObject(42)).toBe(false);
        });

        it('rejects class instances', () => {
            class Foo {}
            expect(isPlainObject(new Foo())).toBe(false);
        });
    });
});
