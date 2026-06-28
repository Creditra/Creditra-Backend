import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ONE_SECOND_MS,
    ONE_MINUTE_MS,
    ONE_HOUR_MS,
    ONE_DAY_MS,
    sleep,
    nowSeconds,
    toUtcIso,
    nowUtcIso,
    parseUtc,
    isUtcIso,
} from '../time.js';

describe('time utils', () => {
    it('exposes consistent duration constants', () => {
        expect(ONE_SECOND_MS).toBe(1000);
        expect(ONE_MINUTE_MS).toBe(60 * 1000);
        expect(ONE_HOUR_MS).toBe(60 * 60 * 1000);
        expect(ONE_DAY_MS).toBe(24 * 60 * 60 * 1000);
    });

    describe('sleep', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('resolves after the requested delay', async () => {
            const promise = sleep(50);
            vi.advanceTimersByTime(50);
            await expect(promise).resolves.toBeUndefined();
        });

        it('treats negative durations as zero', async () => {
            const promise = sleep(-100);
            vi.advanceTimersByTime(0);
            await expect(promise).resolves.toBeUndefined();
        });
    });

    describe('nowSeconds', () => {
        it('returns a finite integer near the current epoch second', () => {
            const value = nowSeconds();
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThan(0);
        });
    });

    describe('UTC handling', () => {
        const iso = '2026-06-29T12:34:56.789Z';

        it('formats a Date as a UTC ISO-8601 string with Z suffix', () => {
            expect(toUtcIso(new Date(iso))).toBe(iso);
            expect(toUtcIso(new Date(iso)).endsWith('Z')).toBe(true);
        });

        it('nowUtcIso returns a valid UTC ISO string', () => {
            expect(isUtcIso(nowUtcIso())).toBe(true);
        });

        it('parses ISO strings and epoch millis as UTC', () => {
            expect(parseUtc(iso)?.toISOString()).toBe(iso);
            expect(parseUtc(Date.parse(iso))?.toISOString()).toBe(iso);
        });

        it('parses a date-only string as UTC midnight (no local drift)', () => {
            expect(parseUtc('2026-06-29')?.toISOString()).toBe('2026-06-29T00:00:00.000Z');
        });

        it('returns null for invalid input', () => {
            expect(parseUtc('not-a-date')).toBeNull();
            expect(parseUtc(Number.NaN)).toBeNull();
        });

        it('isUtcIso rejects offset-bearing or non-Z timestamps', () => {
            expect(isUtcIso(iso)).toBe(true);
            expect(isUtcIso('2026-06-29T12:34:56.789+02:00')).toBe(false);
            expect(isUtcIso('2026-06-29T12:34:56.789')).toBe(false);
            expect(isUtcIso('garbageZ')).toBe(false);
        });

        it('round-trips stably regardless of host time zone', () => {
            const original = '2026-01-01T00:00:00.000Z';
            const reparsed = parseUtc(original);
            expect(reparsed && toUtcIso(reparsed)).toBe(original);
        });
    });
});
