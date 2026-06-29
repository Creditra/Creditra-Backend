/**
 * Contract tests for TransactionRepository implementations.
 * Ensures InMemory and Postgres-backed repositories behave identically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTransactionRepository } from '../memory/InMemoryTransactionRepository.js';
import { TransactionStatus, TransactionType, type CreateTransactionRequest } from '../../models/Transaction.js';
import type { TransactionRepository } from '../interfaces/TransactionRepository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDIT_LINE_ID = '00000000-0000-0000-0000-000000000001';
const WALLET = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';

function sampleRequest(overrides: Partial<CreateTransactionRequest> = {}): CreateTransactionRequest {
  return {
    creditLineId: CREDIT_LINE_ID,
    amount: '100.00',
    type: TransactionType.BORROW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared contract suite
// ---------------------------------------------------------------------------

function runTransactionRepositoryContract(label: string, factory: () => TransactionRepository) {
  describe(`TransactionRepository contract [${label}]`, () => {
    let repo: TransactionRepository;

    beforeEach(() => {
      repo = factory();
    });

    // --- create -----------------------------------------------------------

    describe('create', () => {
      it('assigns a unique id and mirrors request fields', async () => {
        const req = sampleRequest();
        const tx = await repo.create(req);

        expect(tx.id).toBeTruthy();
        expect(tx.creditLineId).toBe(req.creditLineId);
        expect(tx.amount).toBe(req.amount);
        expect(tx.type).toBe(req.type);
        expect(tx.status).toBe(TransactionStatus.PENDING);
        expect(tx.createdAt).toBeInstanceOf(Date);
      });

      it('generates distinct ids for separate creates', async () => {
        const a = await repo.create(sampleRequest());
        const b = await repo.create(sampleRequest());
        expect(a.id).not.toBe(b.id);
      });
    });

    // --- findById ---------------------------------------------------------

    describe('findById', () => {
      it('returns the created record', async () => {
        const tx = await repo.create(sampleRequest());
        const found = await repo.findById(tx.id);
        expect(found).toEqual(tx);
      });

      it('returns null for unknown id', async () => {
        expect(await repo.findById('nonexistent')).toBeNull();
      });
    });

    // --- findByCreditLineId -----------------------------------------------

    describe('findByCreditLineId', () => {
      it('returns only transactions for the specified credit line', async () => {
        const OTHER = '00000000-0000-0000-0000-000000000099';
        await repo.create(sampleRequest({ creditLineId: CREDIT_LINE_ID }));
        await repo.create(sampleRequest({ creditLineId: OTHER }));

        const results = await repo.findByCreditLineId(CREDIT_LINE_ID);
        expect(results).toHaveLength(1);
        expect(results[0].creditLineId).toBe(CREDIT_LINE_ID);
      });

      it('respects limit and offset', async () => {
        for (let i = 0; i < 4; i++) await repo.create(sampleRequest());
        const page1 = await repo.findByCreditLineId(CREDIT_LINE_ID, 0, 2);
        const page2 = await repo.findByCreditLineId(CREDIT_LINE_ID, 2, 2);
        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(2);
        const ids1 = new Set(page1.map((x) => x.id));
        page2.forEach((tx) => expect(ids1.has(tx.id)).toBe(false));
      });
    });

    // --- findAll (offset pagination) --------------------------------------

    describe('findAll', () => {
      it('returns all records within limit', async () => {
        await repo.create(sampleRequest());
        await repo.create(sampleRequest());
        expect(await repo.findAll(0, 100)).toHaveLength(2);
      });

      it('honours limit', async () => {
        for (let i = 0; i < 5; i++) await repo.create(sampleRequest());
        expect(await repo.findAll(0, 3)).toHaveLength(3);
      });
    });

    // --- updateStatus -----------------------------------------------------

    describe('updateStatus', () => {
      it('transitions status to CONFIRMED', async () => {
        const tx = await repo.create(sampleRequest());
        const updated = await repo.updateStatus(tx.id, TransactionStatus.CONFIRMED);
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe(TransactionStatus.CONFIRMED);
        expect(updated!.processedAt).toBeInstanceOf(Date);
      });

      it('returns null for unknown id', async () => {
        expect(await repo.updateStatus('ghost', TransactionStatus.FAILED)).toBeNull();
      });
    });

    // --- findByStatus -----------------------------------------------------

    describe('findByStatus', () => {
      it('returns only transactions with the requested status', async () => {
        const tx = await repo.create(sampleRequest());
        await repo.updateStatus(tx.id, TransactionStatus.CONFIRMED);
        await repo.create(sampleRequest()); // stays PENDING

        const confirmed = await repo.findByStatus(TransactionStatus.CONFIRMED);
        expect(confirmed).toHaveLength(1);
        const pending = await repo.findByStatus(TransactionStatus.PENDING);
        expect(pending).toHaveLength(1);
      });
    });

    // --- count ------------------------------------------------------------

    describe('count', () => {
      it('starts at zero and increments on create', async () => {
        expect(await repo.count()).toBe(0);
        await repo.create(sampleRequest());
        expect(await repo.count()).toBe(1);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Register implementations
// ---------------------------------------------------------------------------

runTransactionRepositoryContract('InMemory', () => new InMemoryTransactionRepository());

// Postgres variant activated via DATABASE_URL in CI:
// if (process.env.DATABASE_URL) {
//   runTransactionRepositoryContract('Postgres', () => new PostgresTransactionRepository(pool));
// }
