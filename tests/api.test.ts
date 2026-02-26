import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

describe('API Integration Tests', () => {

    describe('GET /health', () => {
        it('returns a successful envelope with health status', async () => {
            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                data: { status: 'ok', service: 'creditra-backend' },
                error: null
            });
        });
    });

    describe('Credit Routes', () => {
        it('GET /api/credit/lines returns a successful envelope', async () => {
            const response = await request(app).get('/api/credit/lines');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                data: { creditLines: [] },
                error: null
            });
        });

        it('GET /api/credit/lines/:id returns a standard failure envelope for 404', async () => {
            const response = await request(app).get('/api/credit/lines/123');

            expect(response.status).toBe(404);
            expect(response.body).toEqual({
                data: null,
                error: 'Credit line not found: 123'
            });
        });
    });

    describe('Risk Routes', () => {
        it('POST /api/risk/evaluate returns a standard failure envelope for missing body', async () => {
            const response = await request(app).post('/api/risk/evaluate').send({});

            expect(response.status).toBe(400);
            expect(response.body).toEqual({
                data: null,
                error: 'walletAddress required'
            });
        });

        it('POST /api/risk/evaluate returns a successful envelope with risk status', async () => {
            const response = await request(app)
                .post('/api/risk/evaluate')
                .send({ walletAddress: '0x123' });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                data: {
                    walletAddress: '0x123',
                    riskScore: 0,
                    creditLimit: '0',
                    interestRateBps: 0,
                    message: 'Risk engine not yet connected; placeholder response.',
                },
                error: null
            });
        });
    });

});
