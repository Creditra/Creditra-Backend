import { describe, it, expect, beforeAll } from 'vitest';
import { MockCreditLineRepository } from '../repositories/creditLineRepository.js';
import { CreditLineStatus } from '../models/creditLine.js';
import { creditRouter } from './credit.js';
import express from 'express';
import request from 'supertest';

describe('MockCreditLineRepository', () => {
    it('should return all credit lines', async () => {
        const repo = new MockCreditLineRepository();
        const result = await repo.findAll();
        expect(result.length).toBe(2);
        expect(result[0].id).toBe('cl_001');
    });

    it('should return null for unmatched ID', async () => {
        const repo = new MockCreditLineRepository();
        const result = await repo.findById('invalid-id');
        expect(result).toBeNull();
    });

    it('should return match by ID', async () => {
        const repo = new MockCreditLineRepository();
        const result = await repo.findById('cl_002');
        expect(result?.id).toBe('cl_002');
        expect(result?.status).toBe(CreditLineStatus.SUSPENDED);
    });
});

describe('Credit Router', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/credit', creditRouter);
    });

    it('GET /api/credit/lines should return all lines', async () => {
        const response = await request(app).get('/api/credit/lines');
        expect(response.status).toBe(200);
        expect(response.body.creditLines.length).toBe(2);
        expect(response.body.creditLines[0].id).toBe('cl_001');
    });

    it('GET /api/credit/lines/:id should return 404 if not found', async () => {
        const response = await request(app).get('/api/credit/lines/bad_id');
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Credit line not found');
    });

    it('GET /api/credit/lines/:id should return 200 if found', async () => {
        const response = await request(app).get('/api/credit/lines/cl_001');
        expect(response.status).toBe(200);
        expect(response.body.creditLine.id).toBe('cl_001');
    });

    it('GET /api/credit/lines should return 500 on repository error', async () => {
        const { MockCreditLineRepository } = await import('../repositories/creditLineRepository.js');
        const originalFindAll = MockCreditLineRepository.prototype.findAll;
        MockCreditLineRepository.prototype.findAll = () => Promise.reject(new Error('DB Error'));

        const response = await request(app).get('/api/credit/lines');
        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Internal Server Error');

        MockCreditLineRepository.prototype.findAll = originalFindAll;
    });

    it('GET /api/credit/lines/:id should return 500 on repository error', async () => {
        const { MockCreditLineRepository } = await import('../repositories/creditLineRepository.js');
        const originalFindById = MockCreditLineRepository.prototype.findById;
        MockCreditLineRepository.prototype.findById = () => Promise.reject(new Error('DB Error'));

        const response = await request(app).get('/api/credit/lines/cl_001');
        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Internal Server Error');

        MockCreditLineRepository.prototype.findById = originalFindById;
    });
});
