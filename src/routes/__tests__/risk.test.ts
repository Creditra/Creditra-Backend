import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { riskRouter } from '../risk.js';
import { Container } from '../../container/Container.js';

describe('Risk Routes', () => {
  let app: express.Application;
  let container: Container;

  beforeAll(() => {
    // Use single container instance for all tests
    container = Container.getInstance();
    
    app = express();
    app.use(express.json());
    app.use('/api/risk', riskRouter);
  });

  afterEach(() => {
    // Clear repository data after each test
    if (container.riskEvaluationRepository && typeof (container.riskEvaluationRepository as any).clear === 'function') {
      (container.riskEvaluationRepository as any).clear();
    }
  });

  describe('POST /api/risk/evaluate', () => {
    it('should evaluate risk successfully', async () => {
      const requestBody = {
        walletAddress: 'wallet123'
      };

      const response = await request(app)
        .post('/api/risk/evaluate')
        .send(requestBody)
        .expect(200);

      expect(response.body.walletAddress).toBe('wallet123');
      expect(response.body.riskScore).toBeGreaterThan(0);
      expect(response.body.creditLimit).toBeDefined();
      expect(response.body.interestRateBps).toBeGreaterThan(0);
      expect(response.body.message).toBe('New risk evaluation completed');
    });

    it('should use cached evaluation when available', async () => {
      const walletAddress = 'wallet123';

      // First evaluation
      const response1 = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress })
        .expect(200);

      // Second evaluation (should use cache)
      const response2 = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress })
        .expect(200);

      expect(response2.body.message).toBe('Using cached risk evaluation');
      expect(response2.body.riskScore).toBe(response1.body.riskScore);
    });

    it('should force new evaluation when forceRefresh is true', async () => {
      const walletAddress = 'wallet123';

      // First evaluation
      await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress })
        .expect(200);

      // Force refresh
      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress, forceRefresh: true })
        .expect(200);

      expect(response.body.message).toBe('New risk evaluation completed');
    });

    it('should return 400 for missing wallet address', async () => {
      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('walletAddress required');
    });

    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/risk/evaluate')
        .expect(400);

      expect(response.body.error).toBe('walletAddress required');
    });

    it('should handle service errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.riskEvaluationService;
      const mockService = {
        ...originalService,
        evaluateRisk: async () => {
          throw new Error('Risk evaluation failed');
        }
      };
      
      (container as any)._riskEvaluationService = mockService;

      const response = await request(app)
        .post('/api/risk/evaluate')
        .send({ walletAddress: 'wallet123' })
        .expect(500);

      expect(response.body.error).toBe('Risk evaluation failed');

      // Restore original service
      (container as any)._riskEvaluationService = originalService;
    });
  });

  describe('GET /api/risk/evaluations/:id', () => {
    it('should return risk evaluation when found', async () => {
      // Create a risk evaluation first
      const evalResult = await container.riskEvaluationService.evaluateRisk({
        walletAddress: 'wallet123'
      });

      // Get the evaluation ID from repository
      const latest = await container.riskEvaluationRepository.findLatestByWalletAddress('wallet123');
      
      const response = await request(app)
        .get(`/api/risk/evaluations/${latest!.id}`)
        .expect(200);

      expect(response.body.id).toBe(latest!.id);
      expect(response.body.walletAddress).toBe('wallet123');
    });

    it('should return 404 when evaluation not found', async () => {
      const response = await request(app)
        .get('/api/risk/evaluations/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Risk evaluation not found');
      expect(response.body.id).toBe('nonexistent');
    });

    it('should handle server errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.riskEvaluationService;
      const mockService = {
        ...originalService,
        getRiskEvaluation: async () => {
          throw new Error('Database error');
        }
      };
      
      (container as any)._riskEvaluationService = mockService;

      const response = await request(app)
        .get('/api/risk/evaluations/test-id')
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch risk evaluation');

      // Restore original service
      (container as any)._riskEvaluationService = originalService;
    });
  });

  describe('GET /api/risk/wallet/:walletAddress/latest', () => {
    it('should return latest evaluation for wallet', async () => {
      const walletAddress = 'wallet123';

      // Create evaluation
      await container.riskEvaluationService.evaluateRisk({ walletAddress });

      const response = await request(app)
        .get(`/api/risk/wallet/${walletAddress}/latest`)
        .expect(200);

      expect(response.body.walletAddress).toBe(walletAddress);
      expect(response.body.riskScore).toBeDefined();
    });

    it('should return 404 when no evaluation found', async () => {
      const response = await request(app)
        .get('/api/risk/wallet/nonexistent/latest')
        .expect(404);

      expect(response.body.error).toBe('No risk evaluation found for wallet');
    });

    it('should handle service errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.riskEvaluationService;
      const mockService = {
        ...originalService,
        getLatestRiskEvaluation: async () => {
          throw new Error('Database error');
        }
      };
      
      (container as any)._riskEvaluationService = mockService;

      const response = await request(app)
        .get('/api/risk/wallet/test-wallet/latest')
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch latest risk evaluation');

      // Restore original service
      (container as any)._riskEvaluationService = originalService;
    });
  });

  describe('GET /api/risk/wallet/:walletAddress/history', () => {
    it('should return evaluation history for wallet', async () => {
      const walletAddress = 'wallet123';

      // Create multiple evaluations
      await container.riskEvaluationService.evaluateRisk({ walletAddress, forceRefresh: true });
      await container.riskEvaluationService.evaluateRisk({ walletAddress, forceRefresh: true });

      const response = await request(app)
        .get(`/api/risk/wallet/${walletAddress}/history`)
        .expect(200);

      expect(response.body.evaluations).toHaveLength(2);
      expect(response.body.evaluations.every((evaluation: any) => evaluation.walletAddress === walletAddress)).toBe(true);
    });

    it('should support pagination parameters', async () => {
      const walletAddress = 'wallet123';

      // Create evaluations
      await container.riskEvaluationService.evaluateRisk({ walletAddress, forceRefresh: true });
      await container.riskEvaluationService.evaluateRisk({ walletAddress, forceRefresh: true });
      await container.riskEvaluationService.evaluateRisk({ walletAddress, forceRefresh: true });

      const response = await request(app)
        .get(`/api/risk/wallet/${walletAddress}/history?offset=1&limit=1`)
        .expect(200);

      expect(response.body.evaluations).toHaveLength(1);
    });

    it('should handle invalid pagination parameters', async () => {
      const walletAddress = 'wallet123';

      const response = await request(app)
        .get(`/api/risk/wallet/${walletAddress}/history?offset=invalid&limit=invalid`)
        .expect(200);

      expect(response.body.evaluations).toEqual([]);
    });

    it('should return empty array when no evaluations found', async () => {
      const response = await request(app)
        .get('/api/risk/wallet/nonexistent/history')
        .expect(200);

      expect(response.body.evaluations).toEqual([]);
    });

    it('should handle server errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.riskEvaluationService;
      const mockService = {
        ...originalService,
        getRiskEvaluationHistory: async () => {
          throw new Error('Database error');
        }
      };
      
      (container as any)._riskEvaluationService = mockService;

      const response = await request(app)
        .get('/api/risk/wallet/test-wallet/history')
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch risk evaluation history');

      // Restore original service
      (container as any)._riskEvaluationService = originalService;
    });
  });
});