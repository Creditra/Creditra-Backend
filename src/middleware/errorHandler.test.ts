import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { errorHandlerMiddleware } from './errorHandler.js';
import { logger } from '../logger.js';

describe('errorHandlerMiddleware', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
        errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        errorSpy.mockRestore();
        process.env.NODE_ENV = originalEnv;
    });

    it('should log error with correlation ID', () => {
        const error = new Error('Test error');
        const req = {
            correlationId: 'error-123',
            method: 'POST',
            path: '/api/fail',
        } as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        errorHandlerMiddleware(error, req, res, next);

        expect(errorSpy).toHaveBeenCalledWith(
            'Request error',
            {
                correlationId: 'error-123',
                method: 'POST',
                path: '/api/fail',
            },
            error
        );
    });

    it('should return 500 status code', () => {
        const error = new Error('Test error');
        const req = {
            correlationId: 'error-456',
            method: 'GET',
            path: '/api/test',
        } as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        errorHandlerMiddleware(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should include correlation ID in response', () => {
        const error = new Error('Test error');
        const req = {
            correlationId: 'error-789',
            method: 'GET',
            path: '/api/test',
        } as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        errorHandlerMiddleware(error, req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'Internal server error',
                correlationId: 'error-789',
            })
        );
    });

    it('should expose error details in development mode', () => {
        process.env.NODE_ENV = 'development';

        const error = new Error('Detailed error');
        error.stack = 'Error stack trace';

        const req = {
            correlationId: 'dev-error',
            method: 'GET',
            path: '/api/test',
        } as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        errorHandlerMiddleware(error, req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'Internal server error',
                correlationId: 'dev-error',
                message: 'Detailed error',
                stack: 'Error stack trace',
            })
        );
    });

    it('should not expose error details in production mode', () => {
        process.env.NODE_ENV = 'production';

        const error = new Error('Sensitive error');
        error.stack = 'Sensitive stack trace';

        const req = {
            correlationId: 'prod-error',
            method: 'GET',
            path: '/api/test',
        } as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        errorHandlerMiddleware(error, req, res, next);

        const jsonCall = (res.json as any).mock.calls[0][0];
        expect(jsonCall).toEqual({
            error: 'Internal server error',
            correlationId: 'prod-error',
        });
        expect(jsonCall).not.toHaveProperty('message');
        expect(jsonCall).not.toHaveProperty('stack');
    });

    it('should handle errors without stack traces', () => {
        const error = new Error('Simple error');
        delete error.stack;

        const req = {
            correlationId: 'no-stack',
            method: 'GET',
            path: '/api/test',
        } as Request;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn();

        errorHandlerMiddleware(error, req, res, next);

        expect(errorSpy).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
