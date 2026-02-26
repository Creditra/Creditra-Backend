import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { requestLoggingMiddleware } from './logging.js';
import { logger } from '../logger.js';

describe('requestLoggingMiddleware', () => {
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => { });
        warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        infoSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('should log incoming request', () => {
        const req = {
            correlationId: 'test-123',
            method: 'GET',
            path: '/api/test',
            query: { param: 'value' },
            headers: { 'user-agent': 'test-agent' },
        } as unknown as Request;

        const res = {
            on: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        requestLoggingMiddleware(req, res, next);

        expect(infoSpy).toHaveBeenCalledWith('Incoming request', {
            correlationId: 'test-123',
            method: 'GET',
            path: '/api/test',
            query: { param: 'value' },
            userAgent: 'test-agent',
        });
        expect(next).toHaveBeenCalledOnce();
    });

    it('should log successful response completion', () => {
        const req = {
            correlationId: 'test-456',
            method: 'POST',
            path: '/api/create',
            query: {},
            headers: {},
        } as unknown as Request;

        let finishCallback: () => void = () => { };
        const res = {
            on: vi.fn((event, callback) => {
                if (event === 'finish') {
                    finishCallback = callback;
                }
            }),
            statusCode: 200,
        } as unknown as Response;

        const next = vi.fn();

        requestLoggingMiddleware(req, res, next);

        // Simulate response finish
        finishCallback();

        expect(infoSpy).toHaveBeenCalledTimes(2);
        const completionLog = infoSpy.mock.calls[1];
        expect(completionLog[0]).toBe('Request completed');
        expect(completionLog[1]).toMatchObject({
            correlationId: 'test-456',
            method: 'POST',
            path: '/api/create',
            statusCode: 200,
        });
        expect(completionLog[1]).toHaveProperty('durationMs');
    });

    it('should log error responses with warn level', () => {
        const req = {
            correlationId: 'test-789',
            method: 'GET',
            path: '/api/notfound',
            query: {},
            headers: {},
        } as unknown as Request;

        let finishCallback: () => void = () => { };
        const res = {
            on: vi.fn((event, callback) => {
                if (event === 'finish') {
                    finishCallback = callback;
                }
            }),
            statusCode: 404,
        } as unknown as Response;

        const next = vi.fn();

        requestLoggingMiddleware(req, res, next);
        finishCallback();

        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledWith('Request completed', expect.objectContaining({
            correlationId: 'test-789',
            statusCode: 404,
        }));
    });

    it('should log server error responses with warn level', () => {
        const req = {
            correlationId: 'test-500',
            method: 'POST',
            path: '/api/error',
            query: {},
            headers: {},
        } as unknown as Request;

        let finishCallback: () => void = () => { };
        const res = {
            on: vi.fn((event, callback) => {
                if (event === 'finish') {
                    finishCallback = callback;
                }
            }),
            statusCode: 500,
        } as unknown as Response;

        const next = vi.fn();

        requestLoggingMiddleware(req, res, next);
        finishCallback();

        expect(warnSpy).toHaveBeenCalledWith('Request completed', expect.objectContaining({
            statusCode: 500,
        }));
    });

    it('should measure request duration', async () => {
        const req = {
            correlationId: 'test-duration',
            method: 'GET',
            path: '/api/slow',
            query: {},
            headers: {},
        } as unknown as Request;

        let finishCallback: () => void = () => { };
        const res = {
            on: vi.fn((event, callback) => {
                if (event === 'finish') {
                    finishCallback = callback;
                }
            }),
            statusCode: 200,
        } as unknown as Response;

        const next = vi.fn();

        requestLoggingMiddleware(req, res, next);

        // Simulate some delay
        await new Promise(resolve => setTimeout(resolve, 10));
        finishCallback();

        const completionLog = infoSpy.mock.calls[1];
        expect(completionLog[1]).toHaveProperty('durationMs');
        expect((completionLog[1] as any).durationMs).toBeGreaterThanOrEqual(10);
    });

    it('should handle missing user-agent header', () => {
        const req = {
            correlationId: 'test-no-ua',
            method: 'GET',
            path: '/api/test',
            query: {},
            headers: {},
        } as unknown as Request;

        const res = {
            on: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        requestLoggingMiddleware(req, res, next);

        expect(infoSpy).toHaveBeenCalledWith('Incoming request', expect.objectContaining({
            userAgent: undefined,
        }));
    });
});
