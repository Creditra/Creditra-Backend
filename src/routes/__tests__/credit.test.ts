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

      expect(response.body.data.creditLines).toEqual([]);
      expect(response.body.data.pagination.total).toBe(0);
      expect(response.body.error).toBeNull();
    });

    it('should return credit lines with pagination', async () => {
      // Create test credit lines
      await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2',
        creditLimit: '2000.00',
        interestRateBps: 600
      });

      const response = await request(app)
        .get('/api/credit/lines?offset=0&limit=10')
        .expect(200);

      expect(response.body.data.creditLines).toHaveLength(2);
      expect(response.body.data.pagination.total).toBe(2);
      expect(response.body.data.pagination.offset).toBe(0);
      expect(response.body.data.pagination.limit).toBe(10);
      expect(response.body.error).toBeNull();
    });

    it('should return 400 for negative offset', async () => {
      const response = await request(app)
        .get('/api/credit/lines?offset=-1')
        .expect(400);
      expect(response.body.error).toBe('Offset cannot be negative');
      expect(response.body.data).toBeNull();
    });

    it('should return 400 for zero limit', async () => {
      const response = await request(app)
        .get('/api/credit/lines?limit=0')
        .expect(400);
      expect(response.body.error).toBe('Limit must be greater than 0');
      expect(response.body.data).toBeNull();
    });

    it('should return 400 for oversized limit', async () => {
      const response = await request(app)
        .get('/api/credit/lines?limit=101')
        .expect(400);
      expect(response.body.error).toBe('Limit cannot exceed 100');
      expect(response.body.data).toBeNull();
    });

    it('should handle server errors gracefully', async () => {
      // Mock repository to throw error
      const originalMethod = container.creditLineService.getAllCreditLines;
      container.creditLineService.getAllCreditLines = async () => {
        throw new Error('Database error');
      };

      const response = await request(app)
        .get('/api/credit/lines')
        .expect(400);

      expect(response.body.error).toBe('Database error');
      expect(response.body.data).toBeNull();

      // Restore original method
      container.creditLineService.getAllCreditLines = originalMethod;
    });

    it('should return credit lines with cursor pagination', async () => {
      // Create test credit lines
      for (let i = 0; i < 5; i++) {
        await container.creditLineService.createCreditLine({
          walletAddress: `wallet${i}`,
          creditLimit: '1000.00',
          interestRateBps: 500
        });
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 2));
      }

      const response = await request(app)
        .get('/api/credit/lines?cursor&limit=3')
        .expect(200);

      expect(response.body.creditLines).toHaveLength(3);
      expect(response.body.pagination.limit).toBe(3);
      expect(response.body.pagination.nextCursor).toBeDefined();
      expect(response.body.pagination.hasMore).toBe(true);
      expect(response.body.pagination.total).toBeUndefined(); // No total in cursor mode
    });

    it('should paginate through all items with cursor', async () => {
      // Create test credit lines
      for (let i = 0; i < 7; i++) {
        await container.creditLineService.createCreditLine({
          walletAddress: `wallet${i}`,
          creditLimit: '1000.00',
          interestRateBps: 500
        });
        await new Promise(resolve => setTimeout(resolve, 2));
      }

      // Get first page
      const firstPage = await request(app)
        .get('/api/credit/lines?cursor&limit=3')
        .expect(200);

      expect(firstPage.body.creditLines).toHaveLength(3);
      expect(firstPage.body.pagination.hasMore).toBe(true);
      expect(firstPage.body.pagination.nextCursor).toBeDefined();

      // Get second page
      const secondPage = await request(app)
        .get(`/api/credit/lines?cursor=${firstPage.body.pagination.nextCursor}&limit=3`)
        .expect(200);

      expect(secondPage.body.creditLines).toHaveLength(3);
      expect(secondPage.body.pagination.hasMore).toBe(true);

      // Verify no overlap
      const firstIds = firstPage.body.creditLines.map((cl: any) => cl.id);
      const secondIds = secondPage.body.creditLines.map((cl: any) => cl.id);
      expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);

      // Get third page (last page)
      const thirdPage = await request(app)
        .get(`/api/credit/lines?cursor=${secondPage.body.pagination.nextCursor}&limit=3`)
        .expect(200);

      expect(thirdPage.body.creditLines).toHaveLength(1);
      expect(thirdPage.body.pagination.hasMore).toBe(false);
      expect(thirdPage.body.pagination.nextCursor).toBeNull();
    });

    it('should handle cursor with zero limit error', async () => {
      const response = await request(app)
        .get('/api/credit/lines?cursor&limit=0')
        .expect(400);

      expect(response.body.error).toBe('Limit must be greater than 0');
    });

    it('should handle cursor with oversized limit error', async () => {
      const response = await request(app)
        .get('/api/credit/lines?cursor&limit=101')
        .expect(400);

      expect(response.body.error).toBe('Limit cannot exceed 100');
    });

    it('should return empty result with cursor when no items exist', async () => {
      const response = await request(app)
        .get('/api/credit/lines?cursor&limit=10')
        .expect(200);

      expect(response.body.creditLines).toHaveLength(0);
      expect(response.body.pagination.hasMore).toBe(false);
      expect(response.body.pagination.nextCursor).toBeNull();
    });

    it('should handle invalid cursor gracefully', async () => {
      await container.creditLineService.createCreditLine({
        walletAddress: 'wallet1',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const response = await request(app)
        .get('/api/credit/lines?cursor=invalid-cursor&limit=10')
        .expect(200);

      // Should start from beginning with invalid cursor
      expect(response.body.creditLines).toHaveLength(1);
    });
  });

  describe('GET /api/credit/lines/:id', () => {
    it('should return credit line when found', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const response = await request(app)
        .get(`/api/credit/lines/${created.id}`)
        .expect(200);

      expect(response.body.data.id).toBe(created.id);
      expect(response.body.data.walletAddress).toBe('GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3');
      expect(response.body.error).toBeNull();
    });

    it('should return 404 when credit line not found', async () => {
      const response = await request(app)
        .get('/api/credit/lines/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Credit line not found');
      expect(response.body.data).toBeNull();
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

      expect(response.body.error).toBe('Internal server error');
      expect(response.body.data).toBeNull();

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('POST /api/credit/lines', () => {
    it('should create credit line successfully', async () => {
      const requestBody = {
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      const response = await request(app)
        .post('/api/credit/lines')
        .send(requestBody)
        .expect(201);

      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.walletAddress).toBe(requestBody.walletAddress);
      expect(response.body.data.creditLimit).toBe(requestBody.creditLimit);
      expect(response.body.data.interestRateBps).toBe(requestBody.interestRateBps ?? 0);
      expect(response.body.data.status).toBe(CreditLineStatus.ACTIVE);
      expect(response.body.error).toBeNull();
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/credit/lines')
        .send({
          walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3'
          // Missing creditLimit and interestRateBps
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.data).toBeNull();
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

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.data).toBeNull();
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
          walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
          creditLimit: '1000.00',
          interestRateBps: 500
        })
        .expect(400);

      expect(response.body.error).toBe('Bad request');
      expect(response.body.data).toBeNull();

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('PUT /api/credit/lines/:id', () => {
    it('should update credit line successfully', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
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

      expect(response.body.data.creditLimit).toBe('2000.00');
      expect(response.body.data.interestRateBps).toBe(600);
      expect(response.body.data.status).toBe(CreditLineStatus.SUSPENDED);
      expect(response.body.error).toBeNull();
    });

    it('should return 404 when credit line not found', async () => {
      const response = await request(app)
        .put('/api/credit/lines/nonexistent')
        .send({
          creditLimit: '2000.00'
        })
        .expect(404);

      expect(response.body.error).toBe('Credit line not found');
      expect(response.body.data).toBeNull();
    });

    it('should return 400 for invalid update data', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
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
      expect(response.body.data).toBeNull();
    });

    it('should handle service errors with generic message', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
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

      expect(response.body.error).toBe('Bad request');
      expect(response.body.data).toBeNull();

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('DELETE /api/credit/lines/:id', () => {
    it('should delete credit line successfully', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
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
      expect(response.body.data).toBeNull();
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

      expect(response.body.error).toBe('Internal server error');
      expect(response.body.data).toBeNull();

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });

  describe('GET /api/credit/wallet/:walletAddress/lines', () => {
    it('should return credit lines for wallet', async () => {
      const walletAddress = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3';

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
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S4',
        creditLimit: '500.00',
        interestRateBps: 400
      });

      const response = await request(app)
        .get(`/api/credit/wallet/${walletAddress}/lines`)
        .expect(200);

      expect(response.body.data.creditLines).toHaveLength(2);
      expect(response.body.data.creditLines.every((cl: any) => cl.walletAddress === walletAddress)).toBe(true);
      expect(response.body.error).toBeNull();
    });

    it('should return empty array when no credit lines found for wallet', async () => {
      const response = await request(app)
        .get('/api/credit/wallet/GBAHQCUPC7G2B4D2F2I2K2M2O2Q2W2Y2A2C2E2G2I2K2M2O2Q2S5/lines')
        .expect(200);

      expect(response.body.data.creditLines).toEqual([]);
      expect(response.body.error).toBeNull();
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
        .get('/api/credit/wallet/GBAHQCUPC7G2B4D2F2I2K2M2O2Q2W2Y2A2C2E2G2I2K2M2O2Q2S6/lines')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
      expect(response.body.data).toBeNull();

      // Restore original service
      (container as any)._creditLineService = originalService;
    });
  });
});