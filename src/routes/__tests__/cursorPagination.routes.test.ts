/**
 * Integration tests for the standard cursor pagination model across list endpoints.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { creditRouter } from '../credit.js';
import { apiKeysRouter } from '../apiKeys.js';
import { webhookRouter } from '../webhook.js';
import { Container } from '../../container/Container.js';
import {
  createCreditLine,
  _resetStore,
  getTransactionsWithCursor,
} from '../../services/creditService.js';
import { defaultApiKeyStore } from '../../services/apiKeyStore.js';
import { ADMIN_KEY_HEADER } from '../../middleware/adminAuth.js';
import {
  getWebhookDeliveryStateStore,
  setWebhookDeliveryStateStore,
  type WebhookDeliveryStateStore,
  type DeliveryRecord,
} from '../../services/webhookDeliveryState.js';
import { decodeCursor } from '../../utils/cursorPagination.js';

const ADMIN = 'admin-secret-for-cursor-tests';

function clearCreditLines(container: Container): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repo = container.creditLineRepository as any;
  if (repo && typeof repo.clear === 'function') {
    repo.clear();
  }
}

describe('cursor pagination standard — routes', () => {
  let creditApp: express.Application;
  let adminApp: express.Application;
  let webhookApp: express.Application;
  let container: Container;
  let previousWebhookStore: WebhookDeliveryStateStore;
  let originalAdmin: string | undefined;

  beforeAll(() => {
    container = Container.getInstance();
    creditApp = express();
    creditApp.use(express.json());
    creditApp.use('/api/credit', creditRouter);

    adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/api/admin/api-keys', apiKeysRouter);

    webhookApp = express();
    webhookApp.use(express.json());
    webhookApp.use('/api/webhooks', webhookRouter);
  });

  beforeEach(() => {
    originalAdmin = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN;
    clearCreditLines(container);
    _resetStore();
    previousWebhookStore = getWebhookDeliveryStateStore();
  });

  afterEach(() => {
    if (originalAdmin === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdmin;
    setWebhookDeliveryStateStore(previousWebhookStore);
    clearCreditLines(container);
  });

  describe('GET /api/credit/lines (cursor)', () => {
    it('pages without overlap and ends with hasMore=false', async () => {
      for (let i = 0; i < 5; i++) {
        await container.creditLineService.createCreditLine({
          walletAddress: `wallet-cursor-${i}`,
          creditLimit: '1000.00',
          interestRateBps: 100,
        });
        await new Promise((r) => setTimeout(r, 2));
      }

      const first = await request(creditApp).get('/api/credit/lines?cursor&limit=2').expect(200);
      expect(first.body.creditLines).toHaveLength(2);
      expect(first.body.pagination.hasMore).toBe(true);
      expect(first.body.pagination.nextCursor).toBeTruthy();
      expect(first.body.pagination.nextCursor).not.toMatch(/\|/);

      const second = await request(creditApp)
        .get(
          `/api/credit/lines?cursor=${encodeURIComponent(first.body.pagination.nextCursor)}&limit=2`,
        )
        .expect(200);
      expect(second.body.creditLines).toHaveLength(2);

      const firstIds = first.body.creditLines.map((c: { id: string }) => c.id);
      const secondIds = second.body.creditLines.map((c: { id: string }) => c.id);
      expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);

      const third = await request(creditApp)
        .get(
          `/api/credit/lines?cursor=${encodeURIComponent(second.body.pagination.nextCursor)}&limit=2`,
        )
        .expect(200);
      expect(third.body.creditLines).toHaveLength(1);
      expect(third.body.pagination.hasMore).toBe(false);
      expect(third.body.pagination.nextCursor).toBeNull();
    });

    it('rejects invalid limits', async () => {
      const zero = await request(creditApp).get('/api/credit/lines?cursor&limit=0').expect(400);
      expect(zero.body.error).toMatch(/Limit must be greater than 0/);
      const big = await request(creditApp).get('/api/credit/lines?cursor&limit=101').expect(400);
      expect(big.body.error).toMatch(/Limit cannot exceed 100/);
    });

    it('handles invalid cursor gracefully (starts from beginning)', async () => {
      await container.creditLineService.createCreditLine({
        walletAddress: 'wallet-invalid-cursor',
        creditLimit: '1000.00',
        interestRateBps: 100,
      });
      const res = await request(creditApp)
        .get('/api/credit/lines?cursor=not-a-valid-cursor&limit=10')
        .expect(200);
      expect(res.body.creditLines.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/credit/lines/:id/transactions (cursor)', () => {
    it('returns cursor page envelope for transaction history', async () => {
      const line = createCreditLine('tx-cursor-line');
      const res = await request(creditApp)
        .get(`/api/credit/lines/${line.id}/transactions?cursor&limit=10`)
        .expect(200);

      expect(res.body.data.transactions).toBeDefined();
      expect(res.body.data.pagination).toMatchObject({
        limit: 10,
        hasMore: false,
        nextCursor: null,
      });
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
      expect(res.body.data.transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('service helper returns CursorPage shape', () => {
      const id = 'many-tx-line';
      createCreditLine(id);
      const page = getTransactionsWithCursor(id, {}, { limit: 10 });
      expect(page.items.length).toBeGreaterThanOrEqual(1);
      expect(page).toHaveProperty('nextCursor');
      expect(page).toHaveProperty('hasMore');
      expect(page.limit).toBe(10);
    });

    it('keeps legacy page/limit response when cursor is omitted', async () => {
      const line = createCreditLine('tx-legacy-line');
      const res = await request(creditApp)
        .get(`/api/credit/lines/${line.id}/transactions?page=1&limit=20`)
        .expect(200);
      expect(res.body.data).toMatchObject({
        page: 1,
        limit: 20,
      });
      expect(res.body.data.transactions).toBeDefined();
      expect(res.body.data.total).toBeDefined();
    });
  });

  describe('GET /api/admin/api-keys and /audit (cursor)', () => {
    it('paginates API key list and audit log', async () => {
      const issuedIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const { id } = defaultApiKeyStore.issue(`cursor-label-${Date.now()}-${i}`);
        issuedIds.push(id);
        await new Promise((r) => setTimeout(r, 2));
      }

      const list = await request(adminApp)
        .get('/api/admin/api-keys?cursor&limit=2')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .expect(200);

      expect(list.body.data.items).toHaveLength(2);
      expect(list.body.data.pagination.hasMore).toBe(true);
      expect(list.body.data.pagination.nextCursor).toBeTruthy();
      expect(decodeCursor(list.body.data.pagination.nextCursor)).not.toBeNull();

      const list2 = await request(adminApp)
        .get(
          `/api/admin/api-keys?cursor=${encodeURIComponent(list.body.data.pagination.nextCursor)}&limit=2`,
        )
        .set(ADMIN_KEY_HEADER, ADMIN)
        .expect(200);
      expect(list2.body.data.items.length).toBeGreaterThanOrEqual(1);

      const audit = await request(adminApp)
        .get('/api/admin/api-keys/audit?cursor&limit=2')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .expect(200);
      expect(audit.body.data.items).toHaveLength(2);
      expect(audit.body.data.pagination.limit).toBe(2);
      expect(audit.body.data.pagination.hasMore).toBe(true);
      expect(audit.body.data.pagination.nextCursor).toBeTruthy();

      // Cleanup issued keys (best-effort revoke).
      for (const id of issuedIds) defaultApiKeyStore.revoke(id);
    });

    it('keeps legacy unpaginated responses without cursor param', async () => {
      const list = await request(adminApp)
        .get('/api/admin/api-keys')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .expect(200);
      expect(Array.isArray(list.body.data)).toBe(true);

      const audit = await request(adminApp)
        .get('/api/admin/api-keys/audit')
        .set(ADMIN_KEY_HEADER, ADMIN)
        .expect(200);
      expect(Array.isArray(audit.body.data)).toBe(true);
    });
  });

  describe('GET /api/webhooks/deliveries', () => {
    it('paginates delivery records with stable cursors', async () => {
      const records = new Map<string, DeliveryRecord>();
      const store: WebhookDeliveryStateStore = {
        isDelivered: () => false,
        record: () => undefined,
        deadLetters: () => [],
        list: () => [...records.values()],
        counts: () => ({ total: records.size, delivered: 0, failed: 0, deadLetter: 0 }),
      };
      for (let i = 0; i < 5; i++) {
        const rec: DeliveryRecord = {
          drawId: `draw-${i}`,
          url: `https://example.com/hook/${i}`,
          status: i % 2 === 0 ? 'delivered' : 'failed',
          attempts: 1,
          updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        };
        records.set(`${rec.drawId}::${rec.url}`, rec);
      }
      setWebhookDeliveryStateStore(store);

      const first = await request(webhookApp).get('/api/webhooks/deliveries?limit=2').expect(200);
      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.pagination.hasMore).toBe(true);

      const second = await request(webhookApp)
        .get(
          `/api/webhooks/deliveries?cursor=${encodeURIComponent(first.body.data.pagination.nextCursor)}&limit=2`,
        )
        .expect(200);
      expect(second.body.data.items).toHaveLength(2);

      const firstKeys = first.body.data.items.map(
        (r: DeliveryRecord) => `${r.drawId}::${r.url}`,
      );
      const secondKeys = second.body.data.items.map(
        (r: DeliveryRecord) => `${r.drawId}::${r.url}`,
      );
      expect(firstKeys.some((k: string) => secondKeys.includes(k))).toBe(false);

      const filtered = await request(webhookApp)
        .get('/api/webhooks/deliveries?status=delivered&limit=10')
        .expect(200);
      expect(
        filtered.body.data.items.every((r: DeliveryRecord) => r.status === 'delivered'),
      ).toBe(true);
    });

    it('rejects invalid status filter', async () => {
      await request(webhookApp).get('/api/webhooks/deliveries?status=nope').expect(400);
    });
  });
});
