import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exportsRouter } from '../exports.js';
import { ADMIN_KEY_HEADER } from '../../middleware/adminAuth.js';
import { Container } from '../../container/Container.js';
import { defaultAuditLogStore } from '../../services/auditLogStore.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryTransactionRepository } from '../../repositories/memory/InMemoryTransactionRepository.js';
import { CreditLineStatus } from '../../models/CreditLine.js';
import { TransactionStatus, TransactionType } from '../../models/Transaction.js';

const ADMIN = 'export-admin-secret';

const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-01-31T23:59:59.999Z';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/exports', exportsRouter);
  return app;
}

function rangeQuery(extra: Record<string, string | number> = {}) {
  return { from: FROM, to: TO, ...extra };
}

describe('GET /api/admin/exports/*', () => {
  let originalAdmin: string | undefined;
  let creditRepo: InMemoryCreditLineRepository;
  let txRepo: InMemoryTransactionRepository;

  beforeEach(async () => {
    originalAdmin = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN;
    process.env.NODE_ENV = 'test';

    // Fresh container + repos for isolation.
    Container['instance'] = undefined as unknown as Container;
    creditRepo = new InMemoryCreditLineRepository();
    txRepo = new InMemoryTransactionRepository();
    Container.getInstance().setRepositories({
      creditLineRepository: creditRepo,
      transactionRepository: txRepo,
    });
    defaultAuditLogStore.clear();

    // Seed credit lines inside / outside the export window.
    const inRange = await creditRepo.create({
      walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      creditLimit: '1000.00',
      interestRateBps: 500,
    });
    // Force createdAt into the window for deterministic filtering.
    (inRange as { createdAt: Date }).createdAt = new Date('2026-01-10T12:00:00.000Z');
    (inRange as { updatedAt: Date }).updatedAt = new Date('2026-01-10T12:00:00.000Z');
    (inRange as { status: CreditLineStatus }).status = CreditLineStatus.ACTIVE;

    const outOfRange = await creditRepo.create({
      walletAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      creditLimit: '500.00',
      interestRateBps: 400,
    });
    (outOfRange as { createdAt: Date }).createdAt = new Date('2025-06-01T00:00:00.000Z');
    (outOfRange as { updatedAt: Date }).updatedAt = new Date('2025-06-01T00:00:00.000Z');

    const tx = await txRepo.create({
      creditLineId: inRange.id,
      amount: '50.00',
      type: TransactionType.BORROW,
    });
    (tx as { createdAt: Date }).createdAt = new Date('2026-01-12T08:00:00.000Z');
    (tx as { walletAddress: string }).walletAddress =
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    await txRepo.updateStatus(tx.id, TransactionStatus.CONFIRMED);

    defaultAuditLogStore.append({
      action: 'credit.opened',
      creditLineId: inRange.id,
      occurredAt: '2026-01-10T12:00:00.000Z',
      details: { walletAddress: inRange.walletAddress, creditLimit: '1000.00' },
    });
    defaultAuditLogStore.append({
      action: 'credit.draw_requested',
      creditLineId: inRange.id,
      occurredAt: '2026-01-12T08:00:00.000Z',
      details: { amount: '50.00' },
    });
    // Outside window
    defaultAuditLogStore.append({
      action: 'credit.opened',
      creditLineId: outOfRange.id,
      occurredAt: '2025-06-01T00:00:00.000Z',
      details: {},
    });
  });

  afterEach(() => {
    if (originalAdmin === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdmin;
    defaultAuditLogStore.clear();
    Container['instance'] = undefined as unknown as Container;
  });

  describe('access control', () => {
    it('returns 401 without admin key', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/credit-lines')
        .query(rangeQuery());
      expect(res.status).toBe(401);
    });

    it('returns 401 with wrong admin key', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/transactions')
        .set(ADMIN_KEY_HEADER, 'wrong')
        .query(rangeQuery());
      expect(res.status).toBe(401);
    });

    it('returns 503 when ADMIN_API_KEY is not configured', async () => {
      delete process.env.ADMIN_API_KEY;
      const res = await request(buildApp())
        .get('/api/admin/exports/audit')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery());
      expect(res.status).toBe(503);
    });
  });

  describe('validation / anti-exfiltration', () => {
    it('requires from and to', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/credit-lines')
        .set(ADMIN_KEY_HEADER, ADMIN);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('rejects date ranges longer than 90 days', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/credit-lines')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query({
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-06-01T00:00:00.000Z',
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toMatch(/90 days/);
    });

    it('rejects limit above the hard ceiling', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/transactions')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ limit: 10000 }));
      expect(res.status).toBe(400);
    });

    it('rejects from > to', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/audit')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query({ from: TO, to: FROM });
      expect(res.status).toBe(400);
    });
  });

  describe('credit-lines export', () => {
    it('returns JSON rows filtered by date range', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/credit-lines')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ format: 'json' }));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.error).toBeNull();
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.resource).toBe('credit-lines');
      expect(res.body.meta.truncated).toBe(false);
      expect(res.headers['x-export-count']).toBe('1');
    });

    it('streams CSV with headers', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/credit-lines')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ format: 'csv' }));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      const text = res.text;
      expect(text.split('\n')[0]).toContain('walletAddress');
      expect(text).toContain('1000.00');
    });

    it('filters by status', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/credit-lines')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ status: CreditLineStatus.SUSPENDED }));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('transactions export', () => {
    it('returns matching transactions', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/transactions')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].amount).toBe('50.00');
      expect(res.body.data[0].type).toBe(TransactionType.BORROW);
    });

    it('filters by type', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/transactions')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ type: TransactionType.REPAY }));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('audit export', () => {
    it('returns lifecycle audit records in the window', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/audit')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((r: { action: string }) => r.action)).toEqual(
        expect.arrayContaining(['credit.opened', 'credit.draw_requested']),
      );
    });

    it('filters by action', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/audit')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ action: 'credit.draw_requested' }));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].action).toBe('credit.draw_requested');
    });

    it('exports audit CSV', async () => {
      const res = await request(buildApp())
        .get('/api/admin/exports/audit')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .query(rangeQuery({ format: 'csv' }));
      expect(res.status).toBe(200);
      expect(res.text.split('\n')[0]).toBe('action,creditLineId,occurredAt,details');
      expect(res.text).toContain('credit.opened');
    });
  });
});
