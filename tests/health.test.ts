import request from 'supertest';
import express from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { healthRouter } from '../src/routes/health.js';
import * as dbClient from '../src/db/client.js';
import * as horizonListener from '../src/services/horizonListener.js';

// Create a test app instance
const app = express();
app.use('/health', healthRouter);

vi.mock('../src/db/client.js', () => ({
     getConnection: vi.fn(),
}));

vi.mock('../src/services/horizonListener.js', () => ({
     resolveConfig: vi.fn(),
}));

let fetchSpy: any;

beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true } as Response));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /health/live', () => {
     it('should return health status 200', async () => {
          const res = await request(app).get('/health/live');
          expect(res.status).toBe(200);
          expect(res.body).toEqual({
               status: 'ok',
               service: 'creditra-backend',
          });
     });
});

describe('GET /health', () => {
     beforeEach(() => {
          vi.resetAllMocks();
     });

     it('should return 200 when dependencies are up', async () => {
          const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
          const mockEnd = vi.fn().mockResolvedValue(undefined);
          const mockConnect = vi.fn().mockResolvedValue(undefined);

          vi.mocked(dbClient.getConnection).mockReturnValue({
               query: mockQuery,
               end: mockEnd,
               connect: mockConnect,
          });
          vi.mocked(horizonListener.resolveConfig).mockReturnValue({
               horizonUrl: 'http://test',
               contractIds: [],
               pollIntervalMs: 100,
               startLedger: 'late'
          });
          vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

          const res = await request(app).get('/health');
          expect(res.status).toBe(200);
          expect(res.body).toEqual({
               status: 'ok',
               service: 'creditra-backend',
               dependencies: { database: 'up', horizon: 'up' }
          });
     });

     it('should return 503 when db is down', async () => {
          vi.mocked(dbClient.getConnection).mockImplementation(() => { throw new Error('DB error'); });
          vi.mocked(horizonListener.resolveConfig).mockReturnValue({
               horizonUrl: 'http://test',
               contractIds: [],
               pollIntervalMs: 100,
               startLedger: 'late'
          });
          vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

          const res = await request(app).get('/health');
          expect(res.status).toBe(503);
          expect(res.body.status).toBe('error');
          expect(res.body.dependencies).toEqual({ database: 'down', horizon: 'up' });
     });

     it('should return 503 when horizon is down', async () => {
          const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
          const mockEnd = vi.fn().mockResolvedValue(undefined);

          vi.mocked(dbClient.getConnection).mockReturnValue({
               query: mockQuery,
               end: mockEnd
          });
          vi.mocked(horizonListener.resolveConfig).mockReturnValue({
               horizonUrl: 'http://test',
               contractIds: [],
               pollIntervalMs: 100,
               startLedger: 'late'
          });
          vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

          const res = await request(app).get('/health');
          expect(res.status).toBe(503);
          expect(res.body.status).toBe('error');
          expect(res.body.dependencies).toEqual({ database: 'up', horizon: 'down' });
     });
});