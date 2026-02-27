import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createApiKeyMiddleware } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(apiKey?: string): Partial<Request> {
    return {
        headers: apiKey ? { 'x-api-key': apiKey } : {},
    };
}

function makeRes() {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response;
}

const VALID_KEY = 'test-secret-key';
const VALID_KEYS = new Set([VALID_KEY, 'another-valid-key']);
const requireApiKey = createApiKeyMiddleware(VALID_KEYS);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireApiKey middleware', () => {
    let next: NextFunction;

    beforeEach(() => {
        next = vi.fn();
    });

    it('calls next() when a valid API key is provided', () => {
        const req = makeReq(VALID_KEY);
        const res = makeRes();

        requireApiKey(req as Request, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next() for each valid key in the set', () => {
        for (const key of VALID_KEYS) {
            const n = vi.fn();
            const req = makeReq(key);
            const res = makeRes();

            requireApiKey(req as Request, res, n);

            expect(n).toHaveBeenCalledOnce();
        }
    });

    it('returns 401 when x-api-key header is absent', () => {
        const req = makeReq(); // no key
        const res = makeRes();

        requireApiKey(req as Request, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when x-api-key header is present but invalid', () => {
        const req = makeReq('wrong-key');
        const res = makeRes();

        requireApiKey(req as Request, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
        expect(next).not.toHaveBeenCalled();
    });

    it('does not echo the received key value in the 403 response', () => {
        const badKey = 'super-secret-but-wrong';
        const req = makeReq(badKey);
        const res = makeRes();

        requireApiKey(req as Request, res, next);

        const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
        const jsonStr = JSON.stringify(jsonArg);
        expect(jsonStr).not.toContain(badKey);
    });

    it('returns 401 and does not echo anything when header is an empty string', () => {
        const req = makeReq('');
        const res = makeRes();

        requireApiKey(req as Request, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('is case-sensitive — wrong casing of a valid key returns 403', () => {
        const req = makeReq(VALID_KEY.toUpperCase());
        const res = makeRes();

        requireApiKey(req as Request, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// loadApiKeys() – startup validation
// ---------------------------------------------------------------------------

describe('loadApiKeys', () => {
    it('throws when API_KEYS is not set', async () => {
        delete process.env.API_KEYS;
        const { loadApiKeys } = await import('../config/apiKeys.js');
        expect(() => loadApiKeys()).toThrow(/API_KEYS/);
    });

    it('throws when API_KEYS is an empty string', async () => {
        process.env.API_KEYS = '';
        const { loadApiKeys } = await import('../config/apiKeys.js');
        expect(() => loadApiKeys()).toThrow(/API_KEYS/);
    });

    it('returns a Set of valid keys when API_KEYS is set correctly', async () => {
        process.env.API_KEYS = 'key-a,key-b, key-c ';
        const { loadApiKeys } = await import('../config/apiKeys.js');
        const keys = loadApiKeys();
        expect(keys.has('key-a')).toBe(true);
        expect(keys.has('key-b')).toBe(true);
        expect(keys.has('key-c')).toBe(true);
        expect(keys.size).toBe(3);
    });

    it('ignores blank entries in a comma-separated list', async () => {
        process.env.API_KEYS = 'key-x,,key-y,';
        const { loadApiKeys } = await import('../config/apiKeys.js');
        const keys = loadApiKeys();
        expect(keys.size).toBe(2);
        expect(keys.has('key-x')).toBe(true);
        expect(keys.has('key-y')).toBe(true);
    });
});
