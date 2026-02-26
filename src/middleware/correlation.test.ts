import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { correlationMiddleware, CORRELATION_ID_HEADER } from './correlation.js';

describe('correlationMiddleware', () => {
    it('should generate a correlation ID when not provided', () => {
        const req = {
            headers: {},
        } as Request;

        const res = {
            setHeader: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        correlationMiddleware(req, res, next);

        expect(req.correlationId).toBeDefined();
        expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, req.correlationId);
        expect(next).toHaveBeenCalledOnce();
    });

    it('should use existing correlation ID from header', () => {
        const existingId = 'existing-correlation-id-123';
        const req = {
            headers: {
                [CORRELATION_ID_HEADER]: existingId,
            },
        } as Request;

        const res = {
            setHeader: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        correlationMiddleware(req, res, next);

        expect(req.correlationId).toBe(existingId);
        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, existingId);
        expect(next).toHaveBeenCalledOnce();
    });

    it('should handle uppercase header name', () => {
        const existingId = 'test-id-456';
        const req = {
            headers: {
                'X-Correlation-ID': existingId,
            },
        } as unknown as Request;

        const res = {
            setHeader: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        correlationMiddleware(req, res, next);

        // Express normalizes headers to lowercase
        expect(req.correlationId).toBeDefined();
        expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, req.correlationId);
        expect(next).toHaveBeenCalledOnce();
    });

    it('should generate unique IDs for different requests', () => {
        const req1 = { headers: {} } as Request;
        const req2 = { headers: {} } as Request;
        const res = { setHeader: vi.fn() } as unknown as Response;
        const next = vi.fn();

        correlationMiddleware(req1, res, next);
        correlationMiddleware(req2, res, next);

        expect(req1.correlationId).toBeDefined();
        expect(req2.correlationId).toBeDefined();
        expect(req1.correlationId).not.toBe(req2.correlationId);
    });

    it('should always call next', () => {
        const req = { headers: {} } as Request;
        const res = { setHeader: vi.fn() } as unknown as Response;
        const next = vi.fn();

        correlationMiddleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledWith();
    });
});
