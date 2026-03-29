import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { reconciliationRouter } from '../reconciliation.js';
import { Container } from '../../container/Container.js';

// Mock the Container
vi.mock('../../container/Container.js', () => {
  const mockReconciliationService = {
    scheduleReconciliation: vi.fn(() => 'job-123'),
    jobQueue: {
      size: vi.fn(() => 2),
      getFailedJobs: vi.fn(() => []),
    },
  };

  const mockReconciliationWorker = {
    isRunning: vi.fn(() => true),
  };

  return {
    Container: {
      getInstance: vi.fn(() => ({
        reconciliationService: mockReconciliationService,
        reconciliationWorker: mockReconciliationWorker,
      })),
    },
  };
});

// Mock API keys
vi.mock('../../config/apiKeys.js', () => ({
  loadApiKeys: vi.fn(() => ['test-api-key']),
}));

describe('Reconciliation Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/reconciliation', reconciliationRouter);
    
    vi.clearAllMocks();
  });

  describe('POST /api/reconciliation/trigger', () => {
    it('requires API key authentication', async () => {
      const response = await request(app)
        .post('/api/reconciliation/trigger')
        .send();

      expect(response.status).toBe(401);
    });

    it('schedules reconciliation job with valid API key', async () => {
      const response = await request(app)
        .post('/api/reconciliation/trigger')
        .set('X-API-Key', 'test-api-key')
        .send();

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        data: {
          jobId: 'job-123',
          message: 'Reconciliation job scheduled',
        },
        error: null,
      });

      const container = Container.getInstance();
      expect(container.reconciliationService.scheduleReconciliation).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      const container = Container.getInstance();
      vi.mocked(container.reconciliationService.scheduleReconciliation).mockImplementationOnce(() => {
        throw new Error('Queue full');
      });

      const response = await request(app)
        .post('/api/reconciliation/trigger')
        .set('X-API-Key', 'test-api-key')
        .send();

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Queue full');
    });
  });

  describe('GET /api/reconciliation/status', () => {
    it('requires API key authentication', async () => {
      const response = await request(app)
        .get('/api/reconciliation/status');

      expect(response.status).toBe(401);
    });

    it('returns worker status with valid API key', async () => {
      const response = await request(app)
        .get('/api/reconciliation/status')
        .set('X-API-Key', 'test-api-key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: {
          workerRunning: true,
          queueSize: 2,
          failedJobs: 0,
        },
        error: null,
      });
    });

    it('returns correct failed jobs count', async () => {
      const container = Container.getInstance();
      vi.mocked(container.reconciliationService['jobQueue'].getFailedJobs).mockReturnValueOnce([
        { id: 'failed-1' } as any,
        { id: 'failed-2' } as any,
      ]);

      const response = await request(app)
        .get('/api/reconciliation/status')
        .set('X-API-Key', 'test-api-key');

      expect(response.status).toBe(200);
      expect(response.body.data.failedJobs).toBe(2);
    });

    it('handles worker not running state', async () => {
      const container = Container.getInstance();
      vi.mocked(container.reconciliationWorker.isRunning).mockReturnValueOnce(false);

      const response = await request(app)
        .get('/api/reconciliation/status')
        .set('X-API-Key', 'test-api-key');

      expect(response.status).toBe(200);
      expect(response.body.data.workerRunning).toBe(false);
    });
  });
});
