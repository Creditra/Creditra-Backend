/**
 * Integration tests for ETag / If-None-Match on read-heavy credit endpoints.
 *
 * Covers:
 * - Initial ETag emission on 200
 * - 304 when If-None-Match matches an unchanged representation
 * - ETag invalidation after underlying state changes
 * - Transactions endpoint respects new history / filters
 */
import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { creditRouter } from '../credit.js';
import { dashboardRouter } from '../dashboard.js';
import { Container } from '../../container/Container.js';
import {
  createCreditLine as createInMemoryCreditLine,
  _resetStore,
} from '../../services/creditService.js';

describe('ETag caching — credit read endpoints', () => {
  let app: express.Application;
  let container: Container;

  beforeAll(() => {
    container = Container.getInstance();
    app = express();
    app.use(express.json());
    app.use('/api/credit', creditRouter);
    app.use('/api/dashboard', dashboardRouter);
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (container.creditLineRepository && typeof (container.creditLineRepository as any).clear === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (container.creditLineRepository as any).clear();
    }
    _resetStore();
    container.dashboardSummaryService.invalidate();
  });

  describe('GET /api/credit/lines/:id', () => {
    it('emits ETag and Cache-Control on a full 200 response', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S3',
        creditLimit: '1000.00',
        interestRateBps: 500,
      });

      const res = await request(app).get(`/api/credit/lines/${created.id}`).expect(200);

      expect(res.headers.etag).toBeDefined();
      expect(res.headers.etag).toMatch(/^"/);
      expect(res.headers['cache-control']).toBe('private, must-revalidate');
      expect(res.body.data.id).toBe(created.id);
      expect(res.body.error).toBeNull();
    });

    it('returns 304 Not Modified when If-None-Match matches', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S4',
        creditLimit: '2000.00',
        interestRateBps: 400,
      });

      const first = await request(app).get(`/api/credit/lines/${created.id}`).expect(200);
      const etag = first.headers.etag as string;

      const second = await request(app)
        .get(`/api/credit/lines/${created.id}`)
        .set('If-None-Match', etag)
        .expect(304);

      expect(second.headers.etag).toBe(etag);
      expect(second.headers['cache-control']).toBe('private, must-revalidate');
      // 304 must not carry a body
      expect(second.text === '' || second.text === undefined).toBe(true);
      expect(second.body).toEqual({});
    });

    it('returns a new ETag and full body after the credit line changes', async () => {
      const created = await container.creditLineService.createCreditLine({
        walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S5',
        creditLimit: '1000.00',
        interestRateBps: 500,
      });

      const first = await request(app).get(`/api/credit/lines/${created.id}`).expect(200);
      const oldEtag = first.headers.etag as string;

      await container.creditLineService.updateCreditLine(created.id, {
        creditLimit: '1500.00',
      });

      // Stale validator must not yield 304 once state changed
      const stale = await request(app)
        .get(`/api/credit/lines/${created.id}`)
        .set('If-None-Match', oldEtag)
        .expect(200);

      expect(stale.headers.etag).toBeDefined();
      expect(stale.headers.etag).not.toBe(oldEtag);
      expect(stale.body.data.creditLimit).toBe('1500.00');

      // Fresh validator should 304
      await request(app)
        .get(`/api/credit/lines/${created.id}`)
        .set('If-None-Match', stale.headers.etag as string)
        .expect(304);
    });

    it('does not apply conditional-GET Cache-Control on 404', async () => {
      const res = await request(app).get('/api/credit/lines/does-not-exist').expect(404);
      // Express may attach a weak body ETag; we must not advertise revalidation caching on errors.
      expect(res.headers['cache-control']).not.toBe('private, must-revalidate');
      expect(res.body.error).toBe('Credit line not found');
    });
  });

  describe('GET /api/credit/lines/:id/transactions', () => {
    beforeEach(() => {
      _resetStore();
    });

    it('emits ETag and returns 304 for unchanged transaction history', async () => {
      const line = createInMemoryCreditLine('tx-line-1');

      const first = await request(app)
        .get(`/api/credit/lines/${line.id}/transactions`)
        .expect(200);

      expect(first.headers.etag).toBeDefined();
      expect(first.headers['cache-control']).toBe('private, must-revalidate');
      expect(first.body.data.transactions.length).toBeGreaterThanOrEqual(1);

      const second = await request(app)
        .get(`/api/credit/lines/${line.id}/transactions`)
        .set('If-None-Match', first.headers.etag as string)
        .expect(304);

      expect(second.headers.etag).toBe(first.headers.etag);
    });

    it('invalidates ETag when new transactions are recorded', async () => {
      const line = createInMemoryCreditLine('tx-line-2');

      const first = await request(app)
        .get(`/api/credit/lines/${line.id}/transactions`)
        .expect(200);
      const oldEtag = first.headers.etag as string;
      const oldCount = first.body.data.total as number;

      // Status transition appends a transaction → representation must change.
      const { suspendCreditLine } = await import('../../services/creditService.js');
      suspendCreditLine(line.id);

      const after = await request(app)
        .get(`/api/credit/lines/${line.id}/transactions`)
        .set('If-None-Match', oldEtag)
        .expect(200);

      expect(after.headers.etag).not.toBe(oldEtag);
      expect(after.body.data.total).toBe(oldCount + 1);
    });

    it('uses a different ETag for different query filters', async () => {
      const line = createInMemoryCreditLine('tx-line-3');

      const all = await request(app)
        .get(`/api/credit/lines/${line.id}/transactions`)
        .expect(200);

      const filtered = await request(app)
        .get(`/api/credit/lines/${line.id}/transactions?type=borrow`)
        .expect(200);

      // Different slices must not share validators (safe for client caches)
      expect(all.headers.etag).not.toBe(filtered.headers.etag);
    });
  });

  describe('GET /api/dashboard/summary', () => {
    it('supports ETag revalidation for the dashboard summary', async () => {
      const first = await request(app).get('/api/dashboard/summary').expect(200);
      expect(first.headers.etag).toBeDefined();
      expect(first.headers['cache-control']).toBe('private, must-revalidate');

      const second = await request(app)
        .get('/api/dashboard/summary')
        .set('If-None-Match', first.headers.etag as string)
        .expect(304);

      expect(second.headers.etag).toBe(first.headers.etag);
    });
  });
});
