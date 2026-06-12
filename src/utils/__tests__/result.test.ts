import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr } from '../result.js';

describe('Result utils', () => {
    it('constructs an Ok with the value', () => {
        const r = ok(42);
        expect(r.ok).toBe(true);
        expect(isOk(r)).toBe(true);
        expect(isErr(r)).toBe(false);
        if (r.ok) {
            expect(r.value).toBe(42);
        }
    });

    it('constructs an Err with the error', () => {
        const r = err('boom');
        expect(r.ok).toBe(false);
        expect(isErr(r)).toBe(true);
        expect(isOk(r)).toBe(false);
        if (!r.ok) {
            expect(r.error).toBe('boom');
        }
    });

    it('narrows the type through isOk', () => {
        const r = ok({ id: 'x' });
        if (isOk(r)) {
            expect(r.value.id).toBe('x');
        } else {
            throw new Error('expected ok');
        }
    });

    it('narrows the type through isErr', () => {
        const r = err({ code: 'E_FOO' });
        if (isErr(r)) {
            expect(r.error.code).toBe('E_FOO');
        } else {
            throw new Error('expected err');
        }
    });
});
