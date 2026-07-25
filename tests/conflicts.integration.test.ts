/**
 * Integration tests for consistent 409 conflict detection (issue #227).
 *
 * Covers representative duplicate-resource paths:
 * - credit line open
 * - risk evaluation create
 * - webhook subscription
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { creditRouter } from '../src/routes/credit.js';
import { riskRouter } from '../src/routes/risk.js';
import { webhookRouter } from '../src/routes/webhook.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { Container } from '../src/container/Container.js';
import { InMemoryCreditLineRepository } from '../src/repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryRiskEvaluationRepository } from '../src/repositories/memory/InMemoryRiskEvaluationRepository.js';
import { InMemoryTransactionRepository } from '../src/repositories/memory/InMemoryTransactionRepository.js';
import {
  _resetRuntimeWebhookSubscriptions,
  initializeWebhooks,
} from '../src/services/drawWebhookService.js';

const VALID_WALLET = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/credit', creditRouter);
  app.use('/api/risk', riskRouter);
  app.use('/api/webhooks', webhookRouter);
  app.use(errorHandler);
  return app;
}

describe('409 conflict detection (integration)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';

    const creditRepo = new InMemoryCreditLineRepository();
    const riskRepo = new InMemoryRiskEvaluationRepository();
    const txRepo = new InMemoryTransactionRepository();
    Container.getInstance().setRepositories({
      creditLineRepository: creditRepo,
      riskEvaluationRepository: riskRepo,
      transactionRepository: txRepo,
    });

    _resetRuntimeWebhookSubscriptions();
    delete process.env.WEBHOOK_URLS;
    delete process.env.WEBHOOK_SECRET;
    initializeWebhooks();
  });

  afterEach(() => {
    _resetRuntimeWebhookSubscriptions();
  });

  describe('POST /api/credit/lines — duplicate open', () => {
    it('returns 409 problem+json when an open line already exists', async () => {
      const app = buildApp();
      const body = {
        walletAddress: VALID_WALLET,
        requestedLimit: '1000.00',
        interestRateBps: 500,
      };

      const first = await request(app).post('/api/credit/lines').send(body);
      expect(first.status).toBe(201);

      const second = await request(app).post('/api/credit/lines').send(body);
      expect(second.status).toBe(409);
      expect(second.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(second.body).toMatchObject({
        title: 'Conflict',
        status: 409,
        code: 'duplicate_resource',
        resource: 'credit_line',
        data: null,
      });
      expect(second.body.detail).toMatch(/open credit line already exists/i);
      // Must not leak the wallet address in the conflict payload.
      expect(JSON.stringify(second.body)).not.toContain(VALID_WALLET);
      expect(second.body.error).toBe(second.body.detail);
    });
  });

  describe('POST /api/risk/evaluations — duplicate create', () => {
    it('returns 409 when an unexpired evaluation already exists', async () => {
      const app = buildApp();
      const body = { walletAddress: VALID_WALLET, forceRefresh: false };

      const first = await request(app).post('/api/risk/evaluations').send(body);
      expect(first.status).toBe(201);

      const second = await request(app).post('/api/risk/evaluations').send(body);
      expect(second.status).toBe(409);
      expect(second.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(second.body).toMatchObject({
        code: 'duplicate_resource',
        resource: 'risk_evaluation',
        status: 409,
      });
      expect(JSON.stringify(second.body)).not.toContain(VALID_WALLET);
    });

    it('allows create with forceRefresh when evaluation exists', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/risk/evaluations')
        .send({ walletAddress: VALID_WALLET, forceRefresh: false });

      const refreshed = await request(app)
        .post('/api/risk/evaluations')
        .send({ walletAddress: VALID_WALLET, forceRefresh: true });

      expect(refreshed.status).toBe(201);
      expect(refreshed.body.data).toBeTruthy();
      expect(refreshed.body.error).toBeNull();
    });
  });

  describe('POST /api/webhooks/subscriptions — duplicate URL', () => {
    it('returns 409 problem+json for a duplicate subscription URL', async () => {
      const app = buildApp();
      const url = 'https://hooks.example.com/creditra';

      const first = await request(app).post('/api/webhooks/subscriptions').send({ url });
      expect(first.status).toBe(201);

      const second = await request(app).post('/api/webhooks/subscriptions').send({ url });
      expect(second.status).toBe(409);
      expect(second.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(second.body).toMatchObject({
        code: 'duplicate_resource',
        resource: 'webhook_subscription',
        status: 409,
      });
      // Full URL may carry tokens; conflict details only expose field name.
      expect(second.body.details).toEqual({ field: 'url', reason: 'duplicate_url' });
    });

    it('treats trailing-slash variants as the same subscription', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/webhooks/subscriptions')
        .send({ url: 'https://hooks.example.com/creditra' });

      const second = await request(app)
        .post('/api/webhooks/subscriptions')
        .send({ url: 'https://hooks.example.com/creditra/' });

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('duplicate_resource');
    });
  });
});
