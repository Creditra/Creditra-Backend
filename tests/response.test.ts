import { describe, it, expect, vi } from 'vitest';
import { ok, fail } from '../src/utils/response.js';
import type { Response } from 'express';

describe('Response Helpers Utils', () => {

    // Mock standard Express Response object
    const createMockResponse = () => {
        const res: Partial<Response> = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res as Response;
    };

    describe('ok()', () => {
        it('formats a successful response correctly with default 200 status', () => {
            const res = createMockResponse();
            const data = { id: 1, name: 'Test' };

            ok(res, data);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                data,
                error: null
            });
        });

        it('allows overriding the status code', () => {
            const res = createMockResponse();
            ok(res, 'Created', 201);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                data: 'Created',
                error: null
            });
        });
    });

    describe('fail()', () => {
        it('formats a client error response safely (4xx)', () => {
            const res = createMockResponse();
            fail(res, 'Invalid input parameters', 400);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                data: null,
                error: 'Invalid input parameters'
            });
        });

        it('extracts messages from Error objects for client errors', () => {
            const res = createMockResponse();
            fail(res, new Error('Resource missing'), 404);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                data: null,
                error: 'Resource missing'
            });
        });

        it('defaults to "Bad request" for unknown 4xx error formats', () => {
            const res = createMockResponse();
            fail(res, { some: 'weird object' }, 400);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                data: null,
                error: 'Bad request'
            });
        });

        it('hides internal details for 500 errors if an Error object is passed', () => {
            const res = createMockResponse();
            const err = new Error('Database connection failed - user=root pwd=secret');

            fail(res, err);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                data: null,
                error: 'Internal server error'
            });
        });

        it('allows explicit internal error strings to be sent if provided', () => {
            const res = createMockResponse();

            fail(res, 'Service unavailable due to maintenance', 503);

            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith({
                data: null,
                error: 'Service unavailable due to maintenance'
            });
        });
    });
});
