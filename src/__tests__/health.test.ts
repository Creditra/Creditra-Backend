import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

let fetchSpy: any;

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEYS = 'health-test-key';
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true } as Response));
});

afterAll(() => {
    vi.restoreAllMocks();
});

describe('GET /health/live (public)', () => {
    it('returns 200 with correct service name', async () => {
        const res = await request(app).get('/health/live');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok', service: 'creditra-backend' });
    });
});

describe('GET /health (public)', () => {
    it('returns 200 or 503 depending on testing db setup, but includes dependencies structure', async () => {
        const res = await request(app).get('/health');
        expect([200, 503]).toContain(res.status);
        expect(res.body).toHaveProperty('dependencies');
    });
});
