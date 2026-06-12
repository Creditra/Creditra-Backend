import { describe, it, expect } from 'vitest';
import {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    MIN_PAGE_SIZE,
    DEFAULT_CURSOR_BATCH_SIZE,
    MAX_JSON_BODY_BYTES,
} from '../constants.js';

describe('shared constants', () => {
    it('uses a sensible default page size', () => {
        expect(DEFAULT_PAGE_SIZE).toBeGreaterThanOrEqual(MIN_PAGE_SIZE);
        expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });

    it('keeps min <= max for page size bounds', () => {
        expect(MIN_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
        expect(MIN_PAGE_SIZE).toBeGreaterThan(0);
    });

    it('uses a finite cursor batch size', () => {
        expect(Number.isFinite(DEFAULT_CURSOR_BATCH_SIZE)).toBe(true);
        expect(DEFAULT_CURSOR_BATCH_SIZE).toBeGreaterThan(0);
    });

    it('caps JSON body size at a reasonable value', () => {
        expect(MAX_JSON_BODY_BYTES).toBeGreaterThan(1024);
    });
});
