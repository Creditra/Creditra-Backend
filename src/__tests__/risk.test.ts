import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

const VALID_KEY = 'integration-test-key';

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEYS = VALID_KEY;
});

afterAll(() => {
    delete process.env.API_KEYS;
});

describe('POST /api/risk/evaluate (public)', () => {
    it('returns 200 with a valid walletAddress', async () => {
        const res = await request(app)
            .post('/api/risk/evaluate')
            .send({ walletAddress: '0xDeAdBeEf' });
        expect(res.status).toBe(200);
        expect(res.body.walletAddress).toBe('0xDeAdBeEf');
        expect(res.body).toHaveProperty('riskScore');
        expect(res.body).toHaveProperty('creditLimit');
        expect(res.body).toHaveProperty('interestRateBps');
    });

    it('returns 400 when walletAddress is missing', async () => {
        const res = await request(app).post('/api/risk/evaluate').send({});
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'walletAddress required' });
    });

    it('returns 400 when body is empty', async () => {
        const res = await request(app).post('/api/risk/evaluate');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'walletAddress required' });
    });

    it('does not require an API key', async () => {
        const res = await request(app)
            .post('/api/risk/evaluate')
            .send({ walletAddress: '0x1234' });
        expect(res.status).toBe(200);
    });
});

describe('POST /api/risk/admin/recalibrate (admin – requires API key)', () => {
    it('returns 401 when x-api-key header is missing', async () => {
        const res = await request(app).post('/api/risk/admin/recalibrate');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when x-api-key header has a wrong value', async () => {
        const res = await request(app)
            .post('/api/risk/admin/recalibrate')
            .set('x-api-key', 'wrong-key');
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Forbidden' });
    });

    it('does not expose the wrong key value in the 403 body', async () => {
        const badKey = 'do-not-echo-this';
        const res = await request(app)
            .post('/api/risk/admin/recalibrate')
            .set('x-api-key', badKey);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(badKey);
    });

    it('returns 200 with the valid API key', async () => {
        const res = await request(app)
            .post('/api/risk/admin/recalibrate')
            .set('x-api-key', VALID_KEY);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Risk model recalibration triggered');
    });
});
