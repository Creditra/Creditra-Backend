/**
 * src/__tests__/risk.test.ts
 *
 * Integration tests for POST /api/risk/evaluate
 * Verifies that the request/response logger middleware is active and that
 * log entries contain expected metadata while excluding sensitive data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

// We spy on stdout to capture structured log lines emitted by the logger.
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    process.env.NODE_ENV = 'test';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
    stdoutSpy.mockRestore();
});

/** Parse every JSON line written to stdout during a request. */
function capturedLogLines(): Array<Record<string, unknown>> {
    return stdoutSpy.mock.calls
        .map(([line]: [unknown]) => {
            try { return JSON.parse(String(line)); } catch { return null; }
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────────────────────
// 200 – valid walletAddress
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/risk/evaluate – 200 success', () => {
    it('returns 200 with riskScore, creditLimit, interestRateBps', async () => {
        const res = await request(app)
            .post('/api/risk/evaluate')
            .send({ walletAddress: '0xDeAdBeEf' });

        expect(res.status).toBe(200);
        expect(res.body.walletAddress).toBe('0xDeAdBeEf');
        expect(res.body).toHaveProperty('riskScore');
        expect(res.body).toHaveProperty('creditLimit');
        expect(res.body).toHaveProperty('interestRateBps');
    });

    it('emits a REQUEST log entry with method=POST and correct path', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0x1' });

        const lines = capturedLogLines();
        const reqLog = lines.find((l) => l['message'] === 'REQUEST');
        expect(reqLog).toBeDefined();
        expect(reqLog?.['method']).toBe('POST');
        expect(reqLog?.['path']).toBe('/evaluate');
    });

    it('REQUEST log includes a valid UUID requestId', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0x2' });

        const reqLog = capturedLogLines().find((l) => l['message'] === 'REQUEST');
        expect(reqLog?.['requestId']).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('REQUEST log includes walletAddress (non-sensitive) without redacting it', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0xSafeAddress' });

        const reqLog = capturedLogLines().find((l) => l['message'] === 'REQUEST');
        const body = reqLog?.['body'] as Record<string, unknown>;
        expect(body?.walletAddress).toBe('0xSafeAddress');
    });

    it('emits a RESPONSE log entry with statusCode=200', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0x3' });

        const lines = capturedLogLines();
        const resLog = lines.find((l) => l['message'] === 'RESPONSE');
        expect(resLog).toBeDefined();
        expect(resLog?.['statusCode']).toBe(200);
    });

    it('RESPONSE log includes durationMs (non-negative number)', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0x4' });

        const resLog = capturedLogLines().find((l) => l['message'] === 'RESPONSE');
        expect(typeof resLog?.['durationMs']).toBe('number');
        expect(resLog?.['durationMs'] as number).toBeGreaterThanOrEqual(0);
    });

    it('RESPONSE log does NOT include responseBody for 200', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0x5' });

        const resLog = capturedLogLines().find((l) => l['message'] === 'RESPONSE');
        expect(resLog?.['responseBody']).toBeUndefined();
    });

    it('REQUEST and RESPONSE share the same requestId', async () => {
        await request(app).post('/api/risk/evaluate').send({ walletAddress: '0x6' });

        const lines = capturedLogLines();
        const reqLog = lines.find((l) => l['message'] === 'REQUEST');
        const resLog = lines.find((l) => l['message'] === 'RESPONSE');
        expect(reqLog?.['requestId']).toBe(resLog?.['requestId']);
    });

    it('does not log a raw x-api-key header value', async () => {
        await request(app)
            .post('/api/risk/evaluate')
            .set('x-api-key', 'super-secret-key')
            .send({ walletAddress: '0x7' });

        const raw = JSON.stringify(capturedLogLines());
        expect(raw).not.toContain('super-secret-key');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// 400 – missing walletAddress
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/risk/evaluate – 400 error', () => {
    it('returns 400 when walletAddress is absent', async () => {
        const res = await request(app).post('/api/risk/evaluate').send({});
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'walletAddress required' });
    });

    it('returns 400 for empty body', async () => {
        const res = await request(app).post('/api/risk/evaluate');
        expect(res.status).toBe(400);
    });

    it('emits a warn-level RESPONSE log for 400', async () => {
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const warnSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        await request(app).post('/api/risk/evaluate').send({});

        const warn = warnSpy.mock.calls
            .map(([l]) => { try { return JSON.parse(String(l)); } catch { return null; } })
            .filter(Boolean)
            .find((l: Record<string, unknown>) => l['message'] === 'RESPONSE' && l['level'] === 'warn');

        expect(warn).toBeDefined();
        expect(warn?.['statusCode']).toBe(400);

        warnSpy.mockRestore();
    });

    it('RESPONSE log for 400 includes responseBody with error message', async () => {
        await request(app).post('/api/risk/evaluate').send({});

        const lines = capturedLogLines();
        const resLog = lines.find((l) => l['message'] === 'RESPONSE');
        const body = resLog?.['responseBody'] as Record<string, unknown> | undefined;
        // For 400 responses, responseBody should be logged
        expect(body?.error).toBe('walletAddress required');
    });
});
