import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';
import { AppError, ErrorCode, validationError, notFoundError, authenticationError, authorizationError } from '../../src/errors/index.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a minimal Express app wired with our error middleware
 * and an optional route that throws / calls next(err).
 */
function createTestApp(
    routeHandler?: (req: Request, res: Response, next: NextFunction) => void,
) {
    const app = express();
    app.use(express.json());

    if (routeHandler) {
        app.get('/test', routeHandler);
        app.post('/test', routeHandler);
    }

    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}

/* ================================================================== */
/*  errorHandler middleware                                            */
/* ================================================================== */
describe('errorHandler middleware', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => {
        consoleSpy.mockRestore();
    });

    /* ---- AppError instances ----------------------------------------- */
    it('should return 400 for VALIDATION_ERROR', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(validationError('bad input', { field: 'email' }));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            data: null,
            error: 'bad input',
            code: 'VALIDATION_ERROR',
            details: { field: 'email' },
        });
    });

    it('should return 404 for NOT_FOUND', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(notFoundError('Widget', '7'));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(404);
        expect(res.body).toEqual({
            data: null,
            error: 'Widget with id "7" not found',
            code: 'NOT_FOUND',
            details: { resource: 'Widget', id: '7' },
        });
    });

    it('should return 401 for AUTHENTICATION_ERROR', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(authenticationError('Invalid token'));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            data: null,
            error: 'Invalid token',
            code: 'AUTHENTICATION_ERROR',
        });
    });

    it('should return 403 for AUTHORIZATION_ERROR', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(authorizationError('Admin only'));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
            data: null,
            error: 'Admin only',
            code: 'AUTHORIZATION_ERROR',
        });
    });

    it('should return 500 for INTERNAL_ERROR with AppError', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(new AppError('db crash', ErrorCode.INTERNAL_ERROR));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('db crash');
        expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    /* ---- Unknown / native Error ------------------------------------- */
    it('should treat a plain Error as 500 INTERNAL_ERROR', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(new Error('unexpected'));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Internal server error');
        expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    /* ---- Logging --------------------------------------------------- */
    it('should log 5xx errors via console.error', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(new Error('server on fire'));
        });

        await request(app).get('/test');

        expect(consoleSpy).toHaveBeenCalled();
        const loggedMessage = consoleSpy.mock.calls[0]?.[0] as string;
        expect(loggedMessage).toContain('INTERNAL_ERROR');
    });

    it('should NOT log 4xx errors', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(validationError('nope'));
        });

        await request(app).get('/test');

        expect(consoleSpy).not.toHaveBeenCalled();
    });

    /* ---- No details leakage when absent ----------------------------- */
    it('should omit details key when no details are provided', async () => {
        const app = createTestApp((_req, _res, next) => {
            next(authenticationError());
        });

        const res = await request(app).get('/test');

        expect(res.body).toEqual({
            data: null,
            error: 'Authentication required',
            code: 'AUTHENTICATION_ERROR',
        });
        expect(res.body).not.toHaveProperty('details');
    });

    /* ---- Stack trace in non-prod for 5xx ----------------------------- */
    it('should include stack in details for 5xx in non-production', async () => {
        const origEnv = process.env.NODE_ENV;
        delete process.env.NODE_ENV; // force non-production

        const app = createTestApp((_req, _res, next) => {
            next(new Error('boom'));
        });

        const res = await request(app).get('/test');

        expect(res.body.details).toBeDefined();
        expect(res.body.details.stack).toBeDefined();

        process.env.NODE_ENV = origEnv;
    });

    it('should merge existing object details with stack for 5xx AppError in non-production', async () => {
        const origEnv = process.env.NODE_ENV;
        delete process.env.NODE_ENV; // force non-production

        const app = createTestApp((_req, _res, next) => {
            next(new AppError('db crash', ErrorCode.INTERNAL_ERROR, { host: 'db01' }));
        });

        const res = await request(app).get('/test');

        expect(res.status).toBe(500);
        expect(res.body.details.host).toBe('db01');
        expect(res.body.details.stack).toBeDefined();

        process.env.NODE_ENV = origEnv;
    });

    it('should NOT include stack when NODE_ENV=production', async () => {
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        const app = createTestApp((_req, _res, next) => {
            next(new Error('secret'));
        });

        const res = await request(app).get('/test');

        // details should not exist (plain Error has no details, and prod hides stack)
        expect(res.body.details).toBeUndefined();

        process.env.NODE_ENV = origEnv;
    });
});

/* ================================================================== */
/*  notFoundHandler middleware                                         */
/* ================================================================== */
describe('notFoundHandler middleware', () => {
    it('should return 404 for unmatched routes', async () => {
        const app = createTestApp(); // no routes registered

        const res = await request(app).get('/does-not-exist');

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(res.body.error).toContain('/does-not-exist');
    });

    it('should include the HTTP method in the error message', async () => {
        const app = createTestApp();

        const res = await request(app).post('/nope');

        expect(res.body.error).toContain('POST');
        expect(res.body.error).toContain('/nope');
    });
});
