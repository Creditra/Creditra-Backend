import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

/* We need to suppress the app.listen call during tests. */
vi.spyOn(console, 'log').mockImplementation(() => { });

/* Dynamic import so the spy is in place before the module loads */
const { app } = await import('../../src/index.js');

describe('Integration – error handling across real routes', () => {
    /* ---- Credit routes -------------------------------------------- */
    it('GET /api/credit/lines should return 200 with creditLines', async () => {
        const res = await request(app).get('/api/credit/lines');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            data: { creditLines: [] },
            error: null
        });
    });

    it('GET /api/credit/lines/:id should return a standard 404 error envelope', async () => {
        const res = await request(app).get('/api/credit/lines/abc');

        expect(res.status).toBe(404);
        expect(res.body).toEqual({
            data: null,
            error: 'Credit line with id "abc" not found',
            code: 'NOT_FOUND',
            details: { resource: 'Credit line', id: 'abc' },
        });
    });

    /* ---- Risk routes ----------------------------------------------- */
    it('POST /api/risk/evaluate without walletAddress should return 400', async () => {
        const res = await request(app)
            .post('/api/risk/evaluate')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            data: null,
            error: 'walletAddress is required',
            code: 'VALIDATION_ERROR',
            details: { field: 'walletAddress' },
        });
    });

    it('POST /api/risk/evaluate with walletAddress should return 200', async () => {
        const res = await request(app)
            .post('/api/risk/evaluate')
            .send({ walletAddress: '0xabc' });

        expect(res.status).toBe(200);
        expect(res.body.data.walletAddress).toBe('0xabc');
        expect(res.body.error).toBeNull();
    });

    /* ---- 404 catch-all --------------------------------------------- */
    it('GET /api/nonexistent should return 404 from catch-all', async () => {
        const res = await request(app).get('/api/nonexistent');

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(res.body.error).toContain('/api/nonexistent');
    });

    /* ---- Health check still works ---------------------------------- */
    it('GET /health should return 200', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            data: { status: 'ok', service: 'creditra-backend' },
            error: null
        });
    });
});
