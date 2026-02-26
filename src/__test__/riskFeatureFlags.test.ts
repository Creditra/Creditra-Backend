import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import riskRouter from '../routes/risk.js';
import * as featureFlags from '../utils/featureFlags.js';
import * as riskService from '../services/riskService.js';

vi.mock('../utils/featureFlags.js');
vi.mock('../services/riskService.js');

const app = express();
app.use(express.json());
app.use('/api/risk', riskRouter);

describe('Risk Evaluation Integration with Feature Flags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return default risk evaluation when risk_v2 is disabled', async () => {
        vi.spyOn(featureFlags, 'isFeatureEnabled').mockReturnValue(false);
        vi.spyOn(riskService, 'evaluateWallet').mockResolvedValue({
            address: '0x123',
            score: 50,
            riskLevel: 'medium'
        });

        const response = await request(app)
            .post('/api/risk/evaluate')
            .send({ walletAddress: '0x123' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            address: '0x123',
            score: 50,
            riskLevel: 'medium'
        });
        expect(response.body.model).toBeUndefined();
    });

    it('should return experimental risk evaluation when risk_v2 is enabled', async () => {
        vi.spyOn(featureFlags, 'isFeatureEnabled').mockReturnValue(true);
        vi.spyOn(riskService, 'evaluateWallet').mockResolvedValue({
            address: '0x123',
            score: 50,
            riskLevel: 'medium'
        });

        const response = await request(app)
            .post('/api/risk/evaluate')
            .send({ walletAddress: '0x123' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            address: '0x123',
            score: 50,
            riskLevel: 'medium',
            model: 'risk_v2_experimental',
            highPrecision: true
        });
    });

    it('should return 400 when walletAddress is missing', async () => {
        const response = await request(app)
            .post('/api/risk/evaluate')
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('walletAddress is required');
    });
});
