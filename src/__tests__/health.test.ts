import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEYS = 'health-test-key';
});

describe('GET /health (public)', () => {
    it('returns 200 with correct service name', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok', service: 'creditra-backend' });
    });
});
