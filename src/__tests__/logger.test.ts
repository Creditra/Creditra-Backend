/**
 * src/__tests__/logger.test.ts
 *
 * Unit tests for src/lib/logger.ts
 * – redactObject (shallow + deep + arrays + edge cases)
 * – createLogger  (output format, log levels, requestId propagation)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    redactObject,
    createLogger,
    REDACTED_FIELDS,
} from '../lib/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// redactObject
// ────────────────────────────────────────────────────────────────────────────

describe('redactObject', () => {
    it('returns null unchanged', () => {
        expect(redactObject(null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
        expect(redactObject(undefined)).toBeUndefined();
    });

    it('returns a primitive string unchanged', () => {
        expect(redactObject('hello')).toBe('hello');
    });

    it('returns a number unchanged', () => {
        expect(redactObject(42)).toBe(42);
    });

    it('returns a boolean unchanged', () => {
        expect(redactObject(true)).toBe(true);
    });

    it('redacts a top-level sensitive key (authorization)', () => {
        const input = { authorization: 'Bearer secret-token' };
        const result = redactObject(input);
        expect((result as Record<string, unknown>).authorization).toBe('[REDACTED]');
    });

    it('redacts x-api-key', () => {
        const input = { 'x-api-key': 'my-key' };
        const result = redactObject(input) as Record<string, unknown>;
        expect(result['x-api-key']).toBe('[REDACTED]');
    });

    it('redacts password', () => {
        const input = { password: 'p@ssw0rd', username: 'alice' };
        const result = redactObject(input) as Record<string, unknown>;
        expect(result.password).toBe('[REDACTED]');
        expect(result.username).toBe('alice');
    });

    it('performs case-insensitive key matching', () => {
        const input = { PASSWORD: 'secret', passwOrd: 'also-secret' };
        const result = redactObject(input) as Record<string, unknown>;
        expect(result.PASSWORD).toBe('[REDACTED]');
        expect(result.passwOrd).toBe('[REDACTED]');
    });

    it('does NOT redact a non-sensitive key', () => {
        const input = { walletAddress: '0xDEAD', riskScore: 42 };
        const result = redactObject(input) as Record<string, unknown>;
        expect(result.walletAddress).toBe('0xDEAD');
        expect(result.riskScore).toBe(42);
    });

    it('deep-redacts nested objects', () => {
        const input = { user: { password: 'nested-secret', name: 'Bob' } };
        const result = redactObject(input) as Record<string, Record<string, unknown>>;
        expect(result.user.password).toBe('[REDACTED]');
        expect(result.user.name).toBe('Bob');
    });

    it('redacts sensitive keys inside arrays of objects', () => {
        const input = [{ token: 'tok1', id: 1 }, { token: 'tok2', id: 2 }];
        const result = redactObject(input) as Array<Record<string, unknown>>;
        expect(result[0].token).toBe('[REDACTED]');
        expect(result[0].id).toBe(1);
        expect(result[1].token).toBe('[REDACTED]');
        expect(result[1].id).toBe(2);
    });

    it('does not mutate the original object', () => {
        const original = { secret: 'do-not-touch' };
        redactObject(original);
        expect(original.secret).toBe('do-not-touch');
    });

    it('accepts a custom fields list', () => {
        const input = { customField: 'hide-me', safeField: 'show-me' };
        const result = redactObject(input, ['customField']) as Record<string, unknown>;
        expect(result.customField).toBe('[REDACTED]');
        expect(result.safeField).toBe('show-me');
    });

    it('handles an empty object', () => {
        expect(redactObject({})).toEqual({});
    });

    it('handles an empty array', () => {
        expect(redactObject([])).toEqual([]);
    });

    it('redacts all default REDACTED_FIELDS', () => {
        const input: Record<string, string> = {};
        for (const f of REDACTED_FIELDS) input[f] = 'value';
        const result = redactObject(input) as Record<string, unknown>;
        for (const f of REDACTED_FIELDS) {
            expect(result[f]).toBe('[REDACTED]');
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// createLogger
// ────────────────────────────────────────────────────────────────────────────

describe('createLogger', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
    });

    it('info() writes JSON to stdout', () => {
        const logger = createLogger('test-ctx');
        logger.info('hello');
        expect(stdoutSpy).toHaveBeenCalledOnce();
        const line = String(stdoutSpy.mock.calls[0][0]);
        const parsed = JSON.parse(line);
        expect(parsed.level).toBe('info');
        expect(parsed.context).toBe('test-ctx');
        expect(parsed.message).toBe('hello');
        expect(parsed.ts).toBeDefined();
    });

    it('warn() writes JSON to stdout with level=warn', () => {
        const logger = createLogger('test-ctx');
        logger.warn('watch-out');
        expect(stdoutSpy).toHaveBeenCalledOnce();
        const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
        expect(parsed.level).toBe('warn');
        expect(parsed.message).toBe('watch-out');
    });

    it('error() writes JSON to stderr', () => {
        const logger = createLogger('test-ctx');
        logger.error('something broke');
        expect(stderrSpy).toHaveBeenCalledOnce();
        expect(stdoutSpy).not.toHaveBeenCalled();
        const parsed = JSON.parse(String(stderrSpy.mock.calls[0][0]));
        expect(parsed.level).toBe('error');
        expect(parsed.message).toBe('something broke');
    });

    it('includes arbitrary meta fields in the log entry', () => {
        const logger = createLogger('test-ctx');
        logger.info('with-meta', { requestId: 'abc-123', extra: true });
        const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
        expect(parsed.requestId).toBe('abc-123');
        expect(parsed.extra).toBe(true);
    });

    it('includes a valid ISO timestamp', () => {
        const logger = createLogger('ts-check');
        logger.info('ts');
        const parsed = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
        expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
    });

    it('different contexts produce different context labels', () => {
        const l1 = createLogger('ctx-a');
        const l2 = createLogger('ctx-b');
        l1.info('from a');
        l2.info('from b');
        const p1 = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
        const p2 = JSON.parse(String(stdoutSpy.mock.calls[1][0]));
        expect(p1.context).toBe('ctx-a');
        expect(p2.context).toBe('ctx-b');
    });
});
