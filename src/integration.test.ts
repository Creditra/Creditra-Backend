import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { correlationMiddleware } from './middleware/correlation.js';
import { requestLoggingMiddleware } from './middleware/logging.js';
import { errorHandlerMiddleware } from './middleware/errorHandler.js';
import { logger } from './logger.js';

describe('Integration: Logging and Correlation', () => {
    let app: Express;
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        app = express();
        app.use(correlationMiddleware);
        app.use(express.json());
        app.use(requestLoggingMiddleware);

        infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => { });
        errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        infoSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('should add correlation ID to successful requests', async () => {
        app.get('/test', (req, res) => {
            res.json({ correlationId: req.correlationId });
        });

        const response = await request(app).get('/test');

        expect(response.status).toBe(200);
        expect(response.headers['x-correlation-id']).toBeDefined();
        expect(response.body.correlationId).toBe(response.headers['x-correlation-id']);
    });

    it('should preserve client-provided correlation ID', async () => {
        app.get('/test', (req, res) => {
            res.json({ correlationId: req.correlationId });
        });

        const clientCorrelationId = 'client-provided-id-123';
        const response = await request(app)
            .get('/test')
            .set('x-correlation-id', clientCorrelationId);

        expect(response.status).toBe(200);
        expect(response.headers['x-correlation-id']).toBe(clientCorrelationId);
        expect(response.body.correlationId).toBe(clientCorrelationId);
    });

    it('should log incoming request and completion', async () => {
        app.get('/test', (_req, res) => {
            res.json({ success: true });
        });

        await request(app).get('/test?param=value');

        expect(infoSpy).toHaveBeenCalledWith(
            'Incoming request',
            expect.objectContaining({
                method: 'GET',
                path: '/test',
                query: { param: 'value' },
            })
        );

        expect(infoSpy).toHaveBeenCalledWith(
            'Request completed',
            expect.objectContaining({
                method: 'GET',
                path: '/test',
                statusCode: 200,
            })
        );
    });

    it('should log errors with correlation ID', async () => {
        app.get('/error', () => {
            throw new Error('Test error');
        });
        app.use(errorHandlerMiddleware);

        const response = await request(app).get('/error');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Internal server error');
        expect(response.body.correlationId).toBeDefined();

        expect(errorSpy).toHaveBeenCalledWith(
            'Request error',
            expect.objectContaining({
                correlationId: response.body.correlationId,
                method: 'GET',
                path: '/error',
            }),
            expect.any(Error)
        );
    });

    it('should maintain correlation ID across middleware chain', async () => {
        const correlationIds: string[] = [];

        app.use((req, _res, next) => {
            correlationIds.push(req.correlationId);
            next();
        });

        app.get('/test', (req, res) => {
            correlationIds.push(req.correlationId);
            res.json({ success: true });
        });

        await request(app).get('/test');

        expect(correlationIds).toHaveLength(2);
        expect(correlationIds[0]).toBe(correlationIds[1]);
    });

    it('should handle POST requests with body', async () => {
        app.post('/data', (req, res) => {
            res.json({ received: req.body, correlationId: req.correlationId });
        });

        const response = await request(app)
            .post('/data')
            .send({ key: 'value' });

        expect(response.status).toBe(200);
        expect(response.body.received).toEqual({ key: 'value' });
        expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('should log 404 responses with warn level', async () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => { });

        await request(app).get('/nonexistent');

        expect(warnSpy).toHaveBeenCalledWith(
            'Request completed',
            expect.objectContaining({
                statusCode: 404,
            })
        );

        warnSpy.mockRestore();
    });

    it('should produce parseable JSON logs', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

        // Create fresh logger to bypass mocks
        const realLogger = new (await import('./logger.js')).Logger();
        vi.spyOn(logger, 'info').mockImplementation((msg, ctx) => {
            realLogger.info(msg, ctx);
        });

        app.get('/test', (_req, res) => {
            res.json({ success: true });
        });

        await request(app).get('/test');

        expect(consoleLogSpy).toHaveBeenCalled();
        const logOutput = consoleLogSpy.mock.calls[0][0];
        expect(() => JSON.parse(logOutput)).not.toThrow();

        consoleLogSpy.mockRestore();
    });
});
