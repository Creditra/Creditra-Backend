import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { creditRouter } from '../credit.js';
import { Container } from '../../container/Container.js';
import { CreditLineStatus } from '../../models/CreditLine.js';

describe('Credit Routes', () => {
  let app: express.Application;
  let container: Container;

  beforeAll(() => {
    // Use single container instance for all tests
    container = Container.getInstance();
    
    app = express();
    app.use(express.json());
    app.use('/api/credit', creditRouter);
  });

  afterEach(() => {
    // Clear repository data after each test
    if (container.creditLineRepository && typeof (container.creditLineRepository as any).clear === 'function') {
      (container.creditLineRepository as any).clear();
    }
  });

  describe('GET /api/credit/lines', () => {
    it('should return empty array when no credit lines exist', async () => {
      const response = await request(app)
        .get('/api/credit/lines')
        .expect(200);

      expect(response.body.creditLines).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should return credit lines with pagination', async () => {
      // Create test credit lines
      await container.creditLineService.createCreditLine({
        walletAddress: 'wallet1',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      await container.creditLineService.createCreditLine({
        walletAddress: 'wallet2',
        creditLimit: '2000.00',
        interestRateBps: 600
      });

      const response = await request(app)
        .get('/api/credit/lines?offset=0&limit=10')
        .expect(200);

      expect(response.body.creditLines).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.offset).toBe(0);
      expect(response.body.pagination.limit).toBe(10);
    });

    it('should handle server errors gracefully', async () => {
      // Mock repository to throw error
      const originalMethod = container.creditLineService.getAllCreditLines;
      container.creditLineService.getAllCreditLines = async () => {
        throw new Error('Database error');
      };

      const response = await request(app)
        .get('/api/credit/lines')
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch credit lines');

      // Restore original method
      container.creditLineService.getAllCreditLines = originalMethod;
    });
  });

  describe('GET /api/credit/lines/:id', () => {
    it('should return credit line when found', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const response = await request(app)
        .get(`/api/credit/lines/${created.id}`)
        .expect(200);

      expect(response.body.id).toBe(created.id);
      expect(response.body.walletAddress).toBe('wallet123');
    });

    it('should return 404 when credit line not found', async () => {
      const response = await request(app)
        .get('/api/credit/lines/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Credit line not found');
      expect(response.body.id).toBe('nonexistent');
    });

    it('should handle server errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.creditLineService;
      const mockService = {
        ...originalService,
        getCreditLine: async () => {
          throw new Error('Database error');
        }
      };
      
      (container as any)._creditLineService = mockService;

      const response = await request(app)
        .get('/api/credit/lines/test-id')
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch credit line');

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('POST /api/credit/lines', () => {
    it('should create credit line successfully', async () => {
      const requestBody = {
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      const response = await request(app)
        .post('/api/credit/lines')
        .send(requestBody)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.walletAddress).toBe(requestBody.walletAddress);
      expect(response.body.creditLimit).toBe(requestBody.creditLimit);
      expect(response.body.interestRateBps).toBe(requestBody.interestRateBps);
      expect(response.body.status).toBe(CreditLineStatus.ACTIVE);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/credit/lines')
        .send({
          walletAddress: 'wallet123'
          // Missing creditLimit and interestRateBps
        })
        .expect(400);

      expect(response.body.error).toBe('Missing required fields: walletAddress, creditLimit, interestRateBps');
    });

    it('should return 400 for invalid data', async () => {
      const response = await request(app)
        .post('/api/credit/lines')
        .send({
          walletAddress: '',
          creditLimit: '1000.00',
          interestRateBps: 500
        })
        .expect(400);

      expect(response.body.error).toBe('Missing required fields: walletAddress, creditLimit, interestRateBps');
    });

    it('should handle service errors with generic message', async () => {
      // Mock service to throw a non-Error object
      const originalService = container.creditLineService;
      const mockService = {
        ...originalService,
        createCreditLine: async () => {
          throw 'Some non-error object';
        }
      };
      
      (container as any)._creditLineService = mockService;

      const response = await request(app)
        .post('/api/credit/lines')
        .send({
          walletAddress: 'wallet123',
          creditLimit: '1000.00',
          interestRateBps: 500
        })
        .expect(400);

      expect(response.body.error).toBe('Failed to create credit line');

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('PUT /api/credit/lines/:id', () => {
    it('should update credit line successfully', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const updateData = {
        creditLimit: '2000.00',
        interestRateBps: 600,
        status: CreditLineStatus.SUSPENDED
      };

      const response = await request(app)
        .put(`/api/credit/lines/${created.id}`)
        .send(updateData)
        .expect(200);

      expect(response.body.creditLimit).toBe('2000.00');
      expect(response.body.interestRateBps).toBe(600);
      expect(response.body.status).toBe(CreditLineStatus.SUSPENDED);
    });

    it('should return 404 when credit line not found', async () => {
      const response = await request(app)
        .put('/api/credit/lines/nonexistent')
        .send({
          creditLimit: '2000.00'
        })
        .expect(404);

      expect(response.body.error).toBe('Credit line not found');
    });

    it('should return 400 for invalid update data', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const response = await request(app)
        .put(`/api/credit/lines/${created.id}`)
        .send({
          creditLimit: '-100.00'
        })
        .expect(400);

      expect(response.body.error).toBe('Credit limit must be greater than 0');
    });

    it('should handle service errors with generic message', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      // Mock service to throw a non-Error object
      const originalService = container.creditLineService;
      const mockService = {
        ...originalService,
        updateCreditLine: async () => {
          throw 'Some non-error object';
        }
      };
      
      (container as any)._creditLineService = mockService;

      const response = await request(app)
        .put(`/api/credit/lines/${created.id}`)
        .send({ creditLimit: '2000.00' })
        .expect(400);

      expect(response.body.error).toBe('Failed to update credit line');

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('DELETE /api/credit/lines/:id', () => {
    it('should delete credit line successfully', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      await request(app)
        .delete(`/api/credit/lines/${created.id}`)
        .expect(204);

      // Verify it's deleted
      const found = await container.creditLineService.getCreditLine(created.id);
      expect(found).toBeNull();
    });

    it('should return 404 when credit line not found', async () => {
      const response = await request(app)
        .delete('/api/credit/lines/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Credit line not found');
    });

    it('should handle service errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.creditLineService;
      const mockService = {
        ...originalService,
        deleteCreditLine: async () => {
          throw new Error('Database error');
        }
      };
      
      (container as any)._creditLineService = mockService;

      const response = await request(app)
        .delete('/api/credit/lines/test-id')
        .expect(500);

      expect(response.body.error).toBe('Failed to delete credit line');

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('GET /api/credit/wallet/:walletAddress/lines', () => {
    it('should return credit lines for wallet', async () => {
      const walletAddress = 'wallet123';

      await container.creditLineService.createCreditLine({
        walletAddress,
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      await container.creditLineService.createCreditLine({
        walletAddress,
        creditLimit: '2000.00',
        interestRateBps: 600
      });

      // Create credit line for different wallet
      await container.creditLineService.createCreditLine({
        walletAddress: 'other-wallet',
        creditLimit: '500.00',
        interestRateBps: 400
      });

      const response = await request(app)
        .get(`/api/credit/wallet/${walletAddress}/lines`)
        .expect(200);

      expect(response.body.creditLines).toHaveLength(2);
      expect(response.body.creditLines.every((cl: any) => cl.walletAddress === walletAddress)).toBe(true);
    });

    it('should return empty array when no credit lines found for wallet', async () => {
      const response = await request(app)
        .get('/api/credit/wallet/nonexistent/lines')
        .expect(200);

      expect(response.body.creditLines).toEqual([]);
    });

    it('should handle service errors gracefully', async () => {
      // Mock service to throw error
      const originalService = container.creditLineService;
      const mockService = {
        ...originalService,
        getCreditLinesByWallet: async () => {
          throw new Error('Database error');
        }
      };
      
      (container as any)._creditLineService = mockService;

      const response = await request(app)
        .get('/api/credit/wallet/test-wallet/lines')
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch credit lines for wallet');

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });
});