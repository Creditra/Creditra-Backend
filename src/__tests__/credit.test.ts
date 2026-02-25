/**
 * src/__tests__/credit.test.ts
 *
 * Integration tests for /api/credit routes.
 * Verifies that the request/response logger middleware is active and that
 * log entries carry expected metadata.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    process.env.NODE_ENV = 'test';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
    stdoutSpy.mockRestore();
});

function capturedLogLines(): Array<Record<string, unknown>> {
    return stdoutSpy.mock.calls
        .map(([line]: [unknown]) => {
            try { return JSON.parse(String(line)); } catch { return null; }
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/credit/lines
// ────────────────────────────────────────────────────────────────────────────

describe('GET /api/credit/lines', () => {
    it('returns 200 with creditLines array', async () => {
        const res = await request(app).get('/api/credit/lines');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('creditLines');
        expect(Array.isArray(res.body.creditLines)).toBe(true);
    });

    it('emits REQUEST log with method=GET and correct path', async () => {
        await request(app).get('/api/credit/lines');
        const req = capturedLogLines().find((l) => l['message'] === 'REQUEST');
        expect(req?.['method']).toBe('GET');
        expect(req?.['path']).toBe('/lines');
    });

    it('REQUEST log contains a valid UUID requestId', async () => {
        await request(app).get('/api/credit/lines');
        const req = capturedLogLines().find((l) => l['message'] === 'REQUEST');
        expect(req?.['requestId']).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('emits RESPONSE log with statusCode=200 and durationMs', async () => {
        await request(app).get('/api/credit/lines');
        const res = capturedLogLines().find((l) => l['message'] === 'RESPONSE');
        expect(res?.['statusCode']).toBe(200);
        expect(typeof res?.['durationMs']).toBe('number');
    });

    it('RESPONSE log does NOT include responseBody for 200', async () => {
        await request(app).get('/api/credit/lines');
        const res = capturedLogLines().find((l) => l['message'] === 'RESPONSE');
        expect(res?.['responseBody']).toBeUndefined();
    });

    it('REQUEST and RESPONSE share the same requestId', async () => {
        await request(app).get('/api/credit/lines');
        const lines = capturedLogLines();
        const reqId = lines.find((l) => l['message'] === 'REQUEST')?.['requestId'];
        const resId = lines.find((l) => l['message'] === 'RESPONSE')?.['requestId'];
        expect(reqId).toBe(resId);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/credit/lines/:id  (always 404 on this stub)
// ────────────────────────────────────────────────────────────────────────────

describe('GET /api/credit/lines/:id', () => {
    it('returns 404 with error and id', async () => {
        const res = await request(app).get('/api/credit/lines/abc');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Credit line not found');
        expect(res.body.id).toBe('abc');
    });

    it('emits REQUEST log with correct path for a specific id', async () => {
        await request(app).get('/api/credit/lines/xyz123');
        const req = capturedLogLines().find((l) => l['message'] === 'REQUEST');
        expect(req?.['path']).toBe('/lines/xyz123');
    });

    it('emits warn-level RESPONSE log for 404', async () => {
        await request(app).get('/api/credit/lines/not-found-id');
        const lines = capturedLogLines();
        const res = lines.find((l) => l['message'] === 'RESPONSE');
        // statusCode=404 is non-2xx → should be level warn
        expect(res?.['level']).toBe('warn');
        expect(res?.['statusCode']).toBe(404);
    });

    it('RESPONSE log for 404 includes responseBody with error details', async () => {
        await request(app).get('/api/credit/lines/missing');
        const res = capturedLogLines().find((l) => l['message'] === 'RESPONSE');
        const body = res?.['responseBody'] as Record<string, unknown> | undefined;
        expect(body?.error).toBe('Credit line not found');
        expect(body?.id).toBe('missing');
    });

    it('different requests have different requestIds', async () => {
        await request(app).get('/api/credit/lines');
        const id1 = capturedLogLines().find((l) => l['message'] === 'REQUEST')?.['requestId'];
        stdoutSpy.mockClear();

        await request(app).get('/api/credit/lines/foo');
        const id2 = capturedLogLines().find((l) => l['message'] === 'REQUEST')?.['requestId'];

        expect(id1).not.toBe(id2);
    });
});
