import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supportRouter } from '../support.js';
import { ADMIN_KEY_HEADER } from '../../middleware/adminAuth.js';
import { Container } from '../../container/Container.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryTransactionRepository } from '../../repositories/memory/InMemoryTransactionRepository.js';
import { InMemoryRiskEvaluationRepository } from '../../repositories/memory/InMemoryRiskEvaluationRepository.js';
import { TransactionStatus, TransactionType } from '../../models/Transaction.js';

const ADMIN = 'support-admin-secret-for-tests';
const WALLET = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';
const INVALID_WALLET = 'not-a-stellar-address';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support', supportRouter);
  return app;
}

describe('support tools routes (read-only, admin RBAC)', () => {
  let originalAdminKey: string | undefined;
  let creditLineRepository: InMemoryCreditLineRepository;
  let transactionRepository: InMemoryTransactionRepository;

  beforeEach(() => {
    originalAdminKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = ADMIN;
    process.env.NODE_ENV = 'test';

    creditLineRepository = new InMemoryCreditLineRepository();
    transactionRepository = new InMemoryTransactionRepository();
    Container.getInstance().setRepositories({
      creditLineRepository,
      riskEvaluationRepository: new InMemoryRiskEvaluationRepository(),
      transactionRepository,
    });
  });

  afterEach(() => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = originalAdminKey;
    }
  });

  // ── RBAC boundaries ─────────────────────────────────────────────────────

  it('returns 401 when admin key header is missing', async () => {
    const res = await request(buildApp()).get(`/api/support/borrowers/${WALLET}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/i);
  });

  it('returns 401 when admin key is wrong', async () => {
    const res = await request(buildApp())
      .get(`/api/support/borrowers/${WALLET}`)
      .set(ADMIN_KEY_HEADER, 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 503 when ADMIN_API_KEY is not configured (fail closed)', async () => {
    delete process.env.ADMIN_API_KEY;
    const res = await request(buildApp())
      .get(`/api/support/borrowers/${WALLET}`)
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('rejects non-admin callers on every support path', async () => {
    const app = buildApp();
    const paths = [
      `/api/support/borrowers/${WALLET}`,
      '/api/support/credit-lines/some-id',
      '/api/support/credit-lines/some-id/transactions',
      '/api/support/reconciliation/status',
    ];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it('returns 400 for invalid wallet address', async () => {
    const res = await request(buildApp())
      .get(`/api/support/borrowers/${INVALID_WALLET}`)
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(res.status).toBe(400);
  });

  // ── Happy paths ─────────────────────────────────────────────────────────

  it('returns borrower lookup with redacted wallet and empty lines', async () => {
    const res = await request(buildApp())
      .get(`/api/support/borrowers/${WALLET}`)
      .set(ADMIN_KEY_HEADER, ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data.found).toBe(false);
    expect(res.body.data.walletAddress).toBe('GDRXE2...NLRK');
    expect(res.body.data.creditLines).toEqual([]);
    expect(res.body.data.reconciliation.readOnly).toBe(true);
    // Full wallet must never appear in the body (redaction).
    expect(JSON.stringify(res.body)).not.toContain(WALLET);
  });

  it('returns credit line snapshot + txs for a known line', async () => {
    const line = await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '2500.00',
      interestRateBps: 250,
    });

    const created = await transactionRepository.create({
      creditLineId: line.id,
      amount: '50.00',
      type: TransactionType.BORROW,
      blockchainTxHash: 'txhash-xyz',
    });
    // Patch wallet on the in-memory record so findByCreditLineId returns it with address.
    const map = (transactionRepository as unknown as {
      transactions: Map<string, { walletAddress: string }>;
    }).transactions;
    const stored = map.get(created.id);
    if (stored) stored.walletAddress = WALLET;
    await transactionRepository.updateStatus(created.id, TransactionStatus.CONFIRMED);

    const res = await request(buildApp())
      .get(`/api/support/credit-lines/${line.id}`)
      .set(ADMIN_KEY_HEADER, ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.data.creditLine.id).toBe(line.id);
    expect(res.body.data.creditLine.creditLimit).toBe('2500.00');
    expect(res.body.data.creditLine.walletAddress).toBe('GDRXE2...NLRK');
    expect(res.body.data.recentTransactions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.reconciliation.readOnly).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(WALLET);
  });

  it('returns 404 for unknown credit line', async () => {
    const res = await request(buildApp())
      .get('/api/support/credit-lines/missing-id')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns recent transactions for a credit line', async () => {
    const line = await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '100.00',
      interestRateBps: 0,
    });

    const res = await request(buildApp())
      .get(`/api/support/credit-lines/${line.id}/transactions?limit=5`)
      .set(ADMIN_KEY_HEADER, ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toEqual([]);
  });

  it('returns 404 for transactions on unknown credit line', async () => {
    const res = await request(buildApp())
      .get('/api/support/credit-lines/nope/transactions')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(res.status).toBe(404);
  });

  it('returns read-only reconciliation status', async () => {
    const res = await request(buildApp())
      .get('/api/support/reconciliation/status')
      .set(ADMIN_KEY_HEADER, ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      workerRunning: expect.any(Boolean),
      queueSize: expect.any(Number),
      failedJobs: expect.any(Number),
      readOnly: true,
    });
  });

  // ── Read-only guarantees ────────────────────────────────────────────────

  it('does not expose write methods on the support router', () => {
    const methods = (supportRouter.stack as Array<{ route?: { methods: Record<string, boolean> } }>)
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route!.methods));
    expect(methods.every((m) => m === 'get')).toBe(true);
    expect(methods.some((m) => ['post', 'put', 'patch', 'delete'].includes(m))).toBe(false);
  });

  it('borrower lookup does not mutate credit line count', async () => {
    await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '10.00',
      interestRateBps: 0,
    });
    const before = await creditLineRepository.count();

    await request(buildApp())
      .get(`/api/support/borrowers/${WALLET}`)
      .set(ADMIN_KEY_HEADER, ADMIN);

    const after = await creditLineRepository.count();
    expect(after).toBe(before);
  });
});
