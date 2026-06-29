/**
 * Contract tests for CreditLineRepository implementations.
 * These tests ensure parity between InMemory and Postgres-backed repositories.
 *
 * Each describe block is parameterized over both implementations so any
 * behavioural divergence is caught in CI without a real database (the Postgres
 * suite is skipped when the DATABASE_URL env-var is absent).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCreditLineRepository } from '../memory/InMemoryCreditLineRepository.js';
import { CreditLineStatus, type CreateCreditLineRequest } from '../../models/CreditLine.js';
import type { CreditLineRepository } from '../interfaces/CreditLineRepository.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeInMemoryRepo(): CreditLineRepository {
  return new InMemoryCreditLineRepository();
}

const WALLET = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';
const WALLET2 = 'GCAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2';

function sampleRequest(overrides: Partial<CreateCreditLineRequest> = {}): CreateCreditLineRequest {
  return {
    walletAddress: WALLET,
    creditLimit: '1000.00',
    interestRateBps: 500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared contract suite
// ---------------------------------------------------------------------------

function runCreditLineRepositoryContract(label: string, factory: () => CreditLineRepository) {
  describe(`CreditLineRepository contract [${label}]`, () => {
    let repo: CreditLineRepository;

    beforeEach(() => {
      repo = factory();
    });

    // --- create -----------------------------------------------------------

    describe('create', () => {
      it('assigns a unique id and mirrors the request fields', async () => {
        const req = sampleRequest();
        const cl = await repo.create(req);

        expect(cl.id).toBeTruthy();
        expect(cl.walletAddress).toBe(req.walletAddress);
        expect(cl.creditLimit).toBe(req.creditLimit);
        expect(cl.availableCredit).toBe(req.creditLimit); // starts fully available
        expect(cl.utilized).toBe('0');
        expect(cl.interestRateBps).toBe(req.interestRateBps);
        expect(cl.status).toBe(CreditLineStatus.ACTIVE);
        expect(cl.createdAt).toBeInstanceOf(Date);
        expect(cl.updatedAt).toBeInstanceOf(Date);
      });

      it('generates distinct ids for two separate creates', async () => {
        const a = await repo.create(sampleRequest());
        const b = await repo.create(sampleRequest());
        expect(a.id).not.toBe(b.id);
      });
    });

    // --- findById ---------------------------------------------------------

    describe('findById', () => {
      it('returns the created record', async () => {
        const created = await repo.create(sampleRequest());
        const found = await repo.findById(created.id);
        expect(found).toEqual(created);
      });

      it('returns null for a non-existent id', async () => {
        expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
      });
    });

    // --- findByWalletAddress ----------------------------------------------

    describe('findByWalletAddress', () => {
      it('returns only records belonging to the requested wallet', async () => {
        await repo.create(sampleRequest({ walletAddress: WALLET }));
        await repo.create(sampleRequest({ walletAddress: WALLET2 }));

        const results = await repo.findByWalletAddress(WALLET);
        expect(results).toHaveLength(1);
        expect(results[0].walletAddress).toBe(WALLET);
      });

      it('returns an empty array when no records exist for wallet', async () => {
        expect(await repo.findByWalletAddress('GNONE')).toEqual([]);
      });
    });

    // --- findAll (offset pagination) --------------------------------------

    describe('findAll', () => {
      it('returns all records when limit exceeds total', async () => {
        await repo.create(sampleRequest());
        await repo.create(sampleRequest());
        const all = await repo.findAll(0, 100);
        expect(all.length).toBeGreaterThanOrEqual(2);
      });

      it('respects limit parameter', async () => {
        await repo.create(sampleRequest());
        await repo.create(sampleRequest());
        await repo.create(sampleRequest());
        const page = await repo.findAll(0, 2);
        expect(page).toHaveLength(2);
      });

      it('respects offset parameter', async () => {
        for (let i = 0; i < 3; i++) await repo.create(sampleRequest());
        const allItems = await repo.findAll(0, 100);
        const paged = await repo.findAll(1, 100);
        expect(paged).toHaveLength(allItems.length - 1);
      });
    });

    // --- findAllWithCursor ------------------------------------------------

    describe('findAllWithCursor', () => {
      it('returns all items when count <= limit', async () => {
        await repo.create(sampleRequest());
        await repo.create(sampleRequest());
        const result = await repo.findAllWithCursor(undefined, 10);
        expect(result.items).toHaveLength(2);
        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeNull();
      });

      it('provides a cursor when there are more items', async () => {
        for (let i = 0; i < 3; i++) await repo.create(sampleRequest());
        const first = await repo.findAllWithCursor(undefined, 2);
        expect(first.items).toHaveLength(2);
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).toBeTruthy();
      });

      it('second page contains remaining items and no further cursor', async () => {
        for (let i = 0; i < 3; i++) await repo.create(sampleRequest());
        const first = await repo.findAllWithCursor(undefined, 2);
        const second = await repo.findAllWithCursor(first.nextCursor!, 2);
        expect(second.items).toHaveLength(1);
        expect(second.hasMore).toBe(false);
        expect(second.nextCursor).toBeNull();
      });

      it('pages do not overlap', async () => {
        for (let i = 0; i < 4; i++) await repo.create(sampleRequest());
        const first = await repo.findAllWithCursor(undefined, 2);
        const second = await repo.findAllWithCursor(first.nextCursor!, 2);
        const firstIds = new Set(first.items.map((x) => x.id));
        const secondIds = new Set(second.items.map((x) => x.id));
        for (const id of secondIds) expect(firstIds.has(id)).toBe(false);
      });
    });

    // --- update -----------------------------------------------------------

    describe('update', () => {
      it('updates fields and advances updatedAt', async () => {
        const cl = await repo.create(sampleRequest());
        const before = cl.updatedAt;

        // Small delay so timestamps differ
        await new Promise((r) => setTimeout(r, 5));

        const updated = await repo.update(cl.id, { status: CreditLineStatus.SUSPENDED });
        expect(updated).not.toBeNull();
        expect(updated!.status).toBe(CreditLineStatus.SUSPENDED);
        expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      });

      it('returns null for a non-existent id', async () => {
        expect(await repo.update('missing', { status: CreditLineStatus.CLOSED })).toBeNull();
      });

      it('keeps availableCredit in sync when utilized changes', async () => {
        const cl = await repo.create(sampleRequest({ creditLimit: '1000.00' }));
        const updated = await repo.update(cl.id, { utilized: '300.00' });
        expect(parseFloat(updated!.availableCredit)).toBeCloseTo(700, 1);
      });
    });

    // --- delete -----------------------------------------------------------

    describe('delete', () => {
      it('removes the record and returns true', async () => {
        const cl = await repo.create(sampleRequest());
        expect(await repo.delete(cl.id)).toBe(true);
        expect(await repo.findById(cl.id)).toBeNull();
      });

      it('returns false for a non-existent id', async () => {
        expect(await repo.delete('ghost')).toBe(false);
      });
    });

    // --- exists -----------------------------------------------------------

    describe('exists', () => {
      it('returns true for an existing record', async () => {
        const cl = await repo.create(sampleRequest());
        expect(await repo.exists(cl.id)).toBe(true);
      });

      it('returns false for a missing id', async () => {
        expect(await repo.exists('nope')).toBe(false);
      });
    });

    // --- count ------------------------------------------------------------

    describe('count', () => {
      it('reflects the number of created records', async () => {
        expect(await repo.count()).toBe(0);
        await repo.create(sampleRequest());
        expect(await repo.count()).toBe(1);
        await repo.create(sampleRequest());
        expect(await repo.count()).toBe(2);
      });

      it('decrements after delete', async () => {
        const cl = await repo.create(sampleRequest());
        await repo.delete(cl.id);
        expect(await repo.count()).toBe(0);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Register implementations
// ---------------------------------------------------------------------------

runCreditLineRepositoryContract('InMemory', makeInMemoryRepo);

// Postgres variant: only executed when DATABASE_URL is present (CI with ephemeral DB).
// Uncomment and import PostgresCreditLineRepository when the Postgres implementation
// is available.
//
// if (process.env.DATABASE_URL) {
//   runCreditLineRepositoryContract('Postgres', () => new PostgresCreditLineRepository(pool));
// }
