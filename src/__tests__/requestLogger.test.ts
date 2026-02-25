/**
 * src/__tests__/requestLogger.test.ts
 *
 * Unit tests for src/middleware/requestLogger.ts
 * – verifies REQUEST and RESPONSE log entries
 * – verifies requestId is assigned and propagated
 * – verifies sensitive body fields are redacted in request log
 * – verifies response body is only logged on non-2xx
 * – verifies durationMs is a non-negative number
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRequestLogger } from '../middleware/requestLogger.js';
import type { Logger } from '../lib/logger.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers to create minimal request/response mocks
// ────────────────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
    return {
        id: '',
        method: 'GET',
        path: '/test',
        query: {},
        body: {},
        ...overrides,
    } as unknown as Request;
}

type FinishListener = () => void;

function makeRes(statusCode = 200): { res: Response; triggerFinish: () => void } {
    const listeners: Record<string, FinishListener[]> = {};
    let capturedBody: unknown;

    // Use `as unknown as Response` to sidestep strict overload checking
    // on EventEmitter methods – this is safe in a pure unit-test context.
    const res = {
        statusCode,
        json(body: unknown): unknown {
            capturedBody = body;
            return res;
        },
        on(event: string, cb: () => void): unknown {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
            return res;
        },
    } as unknown as Response;

    const triggerFinish = () => {
        for (const cb of listeners['finish'] ?? []) cb();
    };

    return { res, triggerFinish };
}

function makeNext(): NextFunction {
    return vi.fn() as unknown as NextFunction;
}

function makeLogger(): Logger & {
    infoArgs: Array<[string, Record<string, unknown> | undefined]>;
    warnArgs: Array<[string, Record<string, unknown> | undefined]>;
    errorArgs: Array<[string, Record<string, unknown> | undefined]>;
} {
    const infoArgs: Array<[string, Record<string, unknown> | undefined]> = [];
    const warnArgs: Array<[string, Record<string, unknown> | undefined]> = [];
    const errorArgs: Array<[string, Record<string, unknown> | undefined]> = [];

    return {
        infoArgs,
        warnArgs,
        errorArgs,
        info(msg: string, meta?: Record<string, unknown>) { infoArgs.push([msg, meta]); },
        warn(msg: string, meta?: Record<string, unknown>) { warnArgs.push([msg, meta]); },
        error(msg: string, meta?: Record<string, unknown>) { errorArgs.push([msg, meta]); },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('createRequestLogger middleware', () => {
    it('assigns a unique requestId (UUID) to req.id', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res } = makeRes();

        middleware(req, res, makeNext());

        expect(req.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('calls next()', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res } = makeRes();
        const next = makeNext();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('logs a REQUEST entry immediately with method, path, and query', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq({ method: 'POST', path: '/api/risk/evaluate', query: { dry: 'true' } });
        const { res } = makeRes();

        middleware(req, res, makeNext());

        const [msg, meta] = logger.infoArgs[0];
        expect(msg).toBe('REQUEST');
        expect(meta?.method).toBe('POST');
        expect(meta?.path).toBe('/api/risk/evaluate');
        expect(meta?.query).toEqual({ dry: 'true' });
    });

    it('includes the requestId in the REQUEST log entry', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res } = makeRes();

        middleware(req, res, makeNext());

        const [, meta] = logger.infoArgs[0];
        expect(meta?.requestId).toBe(req.id);
    });

    it('redacts sensitive fields from the request body in REQUEST log', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq({
            body: { walletAddress: '0xABC', password: 'secret', token: 'tok' },
        });
        const { res } = makeRes();

        middleware(req, res, makeNext());

        const [, meta] = logger.infoArgs[0];
        const body = meta?.body as Record<string, unknown>;
        expect(body.walletAddress).toBe('0xABC');
        expect(body.password).toBe('[REDACTED]');
        expect(body.token).toBe('[REDACTED]');
    });

    it('does NOT mutate the original request body when redacting', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq({ body: { password: 'keep-me' } });
        const { res } = makeRes();

        middleware(req, res, makeNext());

        expect(req.body.password).toBe('keep-me');
    });

    it('logs a RESPONSE entry (info) after response finish for 2xx', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res, triggerFinish } = makeRes(200);

        middleware(req, res, makeNext());
        triggerFinish();

        // First call = REQUEST, second call = RESPONSE
        expect(logger.infoArgs).toHaveLength(2);
        const [msg, meta] = logger.infoArgs[1];
        expect(msg).toBe('RESPONSE');
        expect(meta?.statusCode).toBe(200);
        expect(meta?.requestId).toBe(req.id);
    });

    it('durationMs in RESPONSE log is a non-negative number', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res, triggerFinish } = makeRes(200);

        middleware(req, res, makeNext());
        triggerFinish();

        const [, meta] = logger.infoArgs[1];
        expect(typeof meta?.durationMs).toBe('number');
        expect(meta?.durationMs as number).toBeGreaterThanOrEqual(0);
    });

    it('does NOT include responseBody for 2xx responses', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res, triggerFinish } = makeRes(200);

        middleware(req, res, makeNext());
        res.json({ creditLines: [] });
        triggerFinish();

        const [, meta] = logger.infoArgs[1];
        expect(meta?.responseBody).toBeUndefined();
    });

    it('logs RESPONSE as warn for 4xx and includes responseBody', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res, triggerFinish } = makeRes(400);

        middleware(req, res, makeNext());
        res.json({ error: 'walletAddress required' });
        triggerFinish();

        expect(logger.warnArgs).toHaveLength(1);
        const [msg, meta] = logger.warnArgs[0];
        expect(msg).toBe('RESPONSE');
        expect(meta?.statusCode).toBe(400);
        expect(meta?.responseBody).toEqual({ error: 'walletAddress required' });
    });

    it('logs RESPONSE as warn for 5xx and includes responseBody', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res, triggerFinish } = makeRes(500);

        middleware(req, res, makeNext());
        res.json({ error: 'Internal Server Error' });
        triggerFinish();

        expect(logger.warnArgs).toHaveLength(1);
        const [, meta] = logger.warnArgs[0];
        expect(meta?.statusCode).toBe(500);
        expect(meta?.responseBody).toBeDefined();
    });

    it('redacts sensitive fields inside a non-2xx responseBody', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req = makeReq();
        const { res, triggerFinish } = makeRes(401);

        middleware(req, res, makeNext());
        res.json({ error: 'Unauthorized', token: 'leaked-value' });
        triggerFinish();

        const [, meta] = logger.warnArgs[0];
        const body = meta?.responseBody as Record<string, unknown>;
        expect(body.token).toBe('[REDACTED]');
        expect(body.error).toBe('Unauthorized');
    });

    it('assigns different requestIds to different requests', () => {
        const logger = makeLogger();
        const middleware = createRequestLogger(logger);
        const req1 = makeReq();
        const req2 = makeReq();
        const { res: res1 } = makeRes();
        const { res: res2 } = makeRes();

        middleware(req1, res1, makeNext());
        middleware(req2, res2, makeNext());

        expect(req1.id).not.toBe(req2.id);
    });
});
