import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

const VALID_ADDRESS = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2';
const INVALID_ADDRESS = 'invalid-stellar-address';

describe('Stellar Address Validation', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  describe('POST /api/risk/evaluate', () => {
    it('should accept a valid Stellar address', async () => {
      const res = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: VALID_ADDRESS });
      expect(res.status).toBe(200);
    });

    it('should reject an invalid Stellar address', async () => {
      const res = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: INVALID_ADDRESS });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details[0].message).toBe('Invalid Stellar wallet address');
    });
  });

  describe('POST /api/credit/lines', () => {
    it('should accept a valid Stellar address', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: VALID_ADDRESS, requestedLimit: '1000' });
      expect(res.status).toBe(201);
    });

    it('should reject an invalid Stellar address', async () => {
      const res = await request(app)
        .post('/api/credit/lines')
        .send({ walletAddress: INVALID_ADDRESS, requestedLimit: '1000' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('GET /api/credit/wallet/:walletAddress/lines', () => {
    it('should accept a valid Stellar address', async () => {
      const res = await request(app).get(`/api/credit/wallet/${VALID_ADDRESS}/lines`);
      expect(res.status).toBe(200);
    });

    it('should reject an invalid Stellar address', async () => {
      const res = await request(app).get(`/api/credit/wallet/${INVALID_ADDRESS}/lines`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('GET /api/risk/wallet/:walletAddress/latest', () => {
    it('should accept a valid Stellar address', async () => {
      const res = await request(app).get(`/api/risk/wallet/${VALID_ADDRESS}/latest`);
      // It might return 404 if not found, but it should pass validation
      expect([200, 404]).toContain(res.status);
    });

    it('should reject an invalid Stellar address', async () => {
      const res = await request(app).get(`/api/risk/wallet/${INVALID_ADDRESS}/latest`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('GET /api/risk/wallet/:walletAddress/history', () => {
    it('should accept a valid Stellar address', async () => {
      const res = await request(app).get(`/api/risk/wallet/${VALID_ADDRESS}/history`);
      expect(res.status).toBe(200);
    });

    it('should reject an invalid Stellar address', async () => {
      const res = await request(app).get(`/api/risk/wallet/${INVALID_ADDRESS}/history`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });
});
