import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { riskRouter } from '../risk.js';
import { Container } from '../../container/Container.js';

type Method = 'get' | 'post';

interface InvokeArgs {
  method: Method;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

async function invokeRoute(args: InvokeArgs): Promise<{ status: number; body: unknown }> {
  const layer = riskRouter.stack.find(
    (entry: any) =>
      entry.route?.path === args.path &&
      entry.route?.methods?.[args.method] === true,
  );

  if (!layer) {
    throw new Error(`Route not found: ${args.method.toUpperCase()} ${args.path}`);
  }

  const handlers: Array<(req: Request, res: Response, next: NextFunction) => unknown> =
    layer.route.stack.map((entry: any) => entry.handle);

  const req = {
    body: args.body ?? {},
    query: args.query ?? {},
    params: args.params ?? {},
    headers: args.headers ?? {},
  } as unknown as Request;

  const responseState: { status: number; body: unknown; sent: boolean } = {
    status: 200,
    body: undefined,
    sent: false,
  };

  const res = {
    status(code: number) {
      responseState.status = code;
      return this;
    },
    json(payload: unknown) {
      responseState.body = payload;
      responseState.sent = true;
      return this;
    },
  } as unknown as Response;

  for (const handler of handlers) {
    if (responseState.sent) {
      break;
    }

    let nextCalled = false;

    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      Promise.resolve(handler(req, res, next)).then(() => {
        if (!nextCalled) resolve();
      }).catch(reject);
    });
  }

  return { status: responseState.status, body: responseState.body };
}

describe('Risk Routes', () => {
  let container: Container;
  const validApiKey = 'risk-routes-test-key';

  beforeAll(() => {
    process.env.API_KEYS = validApiKey;
    container = Container.getInstance();
  });

  afterAll(() => {
    delete process.env.API_KEYS;
  });

  afterEach(() => {
    if (typeof (container.riskEvaluationRepository as any).clear === 'function') {
      (container.riskEvaluationRepository as any).clear();
    }
  });

  describe('POST /evaluate', () => {
    it('evaluates risk and returns enveloped response', async () => {
      const response = await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2',
          message: 'New risk evaluation completed',
        },
        error: null,
      });
    });

    it('uses cached evaluation when available', async () => {
      await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      const response = await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      expect((response.body as any).data.message).toBe('Using cached risk evaluation');
    });

    it('forces refresh when requested', async () => {
      await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      const response = await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2', forceRefresh: true },
      });

      expect((response.body as any).data.message).toBe('New risk evaluation completed');
    });

    it('rejects missing walletAddress via schema validation', async () => {
      const response = await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: {},
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Validation failed',
      });
    });

    it('rejects unknown keys via strict schema', async () => {
      const response = await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2', unknown: 'x' },
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Validation failed',
      });
    });

    it('returns 500 when service throws', async () => {
      const originalService = container.riskEvaluationService;
      (container as any)._riskEvaluationService = {
        ...originalService,
        evaluateRisk: async () => {
          throw new Error('boom');
        },
      };

      const response = await invokeRoute({
        method: 'post',
        path: '/evaluate',
        body: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ data: null, error: 'Internal server error' });

      (container as any)._riskEvaluationService = originalService;
    });
  });

  describe('GET endpoints', () => {
    it('returns evaluation by id', async () => {
      await container.riskEvaluationService.evaluateRisk({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' });
      const latest = await container.riskEvaluationRepository.findLatestByWalletAddress('GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2');

      const response = await invokeRoute({
        method: 'get',
        path: '/evaluations/:id',
        params: { id: latest!.id },
      });

      expect(response.status).toBe(200);
      expect((response.body as any).data.id).toBe(latest!.id);
    });

    it('returns 404 when evaluation is missing', async () => {
      const response = await invokeRoute({
        method: 'get',
        path: '/evaluations/:id',
        params: { id: 'missing' },
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ data: null, error: 'Risk evaluation not found' });
    });

    it('returns 500 when evaluation fetch throws', async () => {
      const originalService = container.riskEvaluationService;
      (container as any)._riskEvaluationService = {
        ...originalService,
        getRiskEvaluation: async () => {
          throw new Error('db');
        },
      };

      const response = await invokeRoute({
        method: 'get',
        path: '/evaluations/:id',
        params: { id: 'id' },
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ data: null, error: 'Failed to fetch risk evaluation' });
      (container as any)._riskEvaluationService = originalService;
    });

    it('returns latest evaluation for wallet', async () => {
      await container.riskEvaluationService.evaluateRisk({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' });

      const response = await invokeRoute({
        method: 'get',
        path: '/wallet/:walletAddress/latest',
        params: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      expect(response.status).toBe(200);
      expect((response.body as any).data.walletAddress).toBe('GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2');
    });

    it('returns 404 for missing latest evaluation', async () => {
      const response = await invokeRoute({
        method: 'get',
        path: '/wallet/:walletAddress/latest',
        params: { walletAddress: 'missing' },
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ data: null, error: 'No risk evaluation found for wallet' });
    });

    it('returns 500 when latest evaluation fetch throws', async () => {
      const originalService = container.riskEvaluationService;
      (container as any)._riskEvaluationService = {
        ...originalService,
        getLatestRiskEvaluation: async () => {
          throw new Error('db');
        },
      };

      const response = await invokeRoute({
        method: 'get',
        path: '/wallet/:walletAddress/latest',
        params: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ data: null, error: 'Failed to fetch latest risk evaluation' });
      (container as any)._riskEvaluationService = originalService;
    });

    it('returns history with pagination', async () => {
      await container.riskEvaluationService.evaluateRisk({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2', forceRefresh: true });
      await container.riskEvaluationService.evaluateRisk({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2', forceRefresh: true });
      await container.riskEvaluationService.evaluateRisk({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2', forceRefresh: true });

      const response = await invokeRoute({
        method: 'get',
        path: '/wallet/:walletAddress/history',
        params: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
        query: { offset: '1', limit: '1' },
      });

      expect(response.status).toBe(200);
      expect((response.body as any).data.evaluations).toHaveLength(1);
    });

    it('rejects invalid query types for history', async () => {
      const response = await invokeRoute({
        method: 'get',
        path: '/wallet/:walletAddress/history',
        params: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
        query: { offset: 'bad', limit: 'bad' },
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'Validation failed' });
    });

    it('returns 500 when history fetch throws', async () => {
      const originalService = container.riskEvaluationService;
      (container as any)._riskEvaluationService = {
        ...originalService,
        getRiskEvaluationHistory: async () => {
          throw new Error('db');
        },
      };

      const response = await invokeRoute({
        method: 'get',
        path: '/wallet/:walletAddress/history',
        params: { walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2' },
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ data: null, error: 'Failed to fetch risk evaluation history' });
      (container as any)._riskEvaluationService = originalService;
    });
  });

  describe('Admin endpoint', () => {
    it('requires API key', async () => {
      const response = await invokeRoute({
        method: 'post',
        path: '/admin/recalibrate',
      });

      expect(response.status).toBe(401);
    });

    it('rejects invalid API key', async () => {
      const response = await invokeRoute({
        method: 'post',
        path: '/admin/recalibrate',
        headers: { 'x-api-key': 'bad-key' },
      });

      expect(response.status).toBe(403);
    });

    it('accepts valid API key', async () => {
      const response = await invokeRoute({
        method: 'post',
        path: '/admin/recalibrate',
        headers: { 'x-api-key': validApiKey },
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: { message: 'Risk model recalibration triggered' },
        error: null,
      });
    });
  });
});
