/**
 * Contract tests for RiskEvaluationRepository implementations.
 * Ensures InMemory and Postgres-backed repositories behave identically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRiskEvaluationRepository } from '../memory/InMemoryRiskEvaluationRepository.js';
import type { RiskEvaluationRepository } from '../interfaces/RiskEvaluationRepository.js';
import type { RiskEvaluation } from '../../models/RiskEvaluation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WALLET = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';
const WALLET2 = 'GCAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2';

function futureDate(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

function pastDate(offsetMs: number): Date {
  return new Date(Date.now() - offsetMs);
}

function sampleEvaluation(overrides: Partial<Omit<RiskEvaluation, 'id'>> = {}): Omit<RiskEvaluation, 'id'> {
  return {
    walletAddress: WALLET,
    riskScore: 42,
    creditLimit: '5000.00',
    interestRateBps: 300,
    factors: [{ name: 'history', value: 0.7, weight: 1.0 }],
    evaluatedAt: new Date(),
    expiresAt: futureDate(3_600_000), // expires in 1 hour
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared contract suite
// ---------------------------------------------------------------------------

function runRiskEvaluationRepositoryContract(label: string, factory: () => RiskEvaluationRepository) {
  describe(`RiskEvaluationRepository contract [${label}]`, () => {
    let repo: RiskEvaluationRepository;

    beforeEach(() => {
      repo = factory();
    });

    // --- save -------------------------------------------------------------

    describe('save', () => {
      it('persists the evaluation and assigns an id', async () => {
        const ev = sampleEvaluation();
        const saved = await repo.save(ev);

        expect(saved.id).toBeTruthy();
        expect(saved.walletAddress).toBe(ev.walletAddress);
        expect(saved.riskScore).toBe(ev.riskScore);
        expect(saved.creditLimit).toBe(ev.creditLimit);
      });

      it('generates distinct ids for separate saves', async () => {
        const a = await repo.save(sampleEvaluation());
        const b = await repo.save(sampleEvaluation());
        expect(a.id).not.toBe(b.id);
      });
    });

    // --- findById ---------------------------------------------------------

    describe('findById', () => {
      it('returns the saved record', async () => {
        const saved = await repo.save(sampleEvaluation());
        expect(await repo.findById(saved.id)).toEqual(saved);
      });

      it('returns null for unknown id', async () => {
        expect(await repo.findById('missing')).toBeNull();
      });
    });

    // --- findLatestByWalletAddress ----------------------------------------

    describe('findLatestByWalletAddress', () => {
      it('returns the most recently evaluated record', async () => {
        const old = sampleEvaluation({ evaluatedAt: pastDate(5000), walletAddress: WALLET });
        const recent = sampleEvaluation({ evaluatedAt: new Date(), walletAddress: WALLET });
        await repo.save(old);
        const savedRecent = await repo.save(recent);

        const latest = await repo.findLatestByWalletAddress(WALLET);
        expect(latest).not.toBeNull();
        expect(latest!.id).toBe(savedRecent.id);
      });

      it('returns null when no records exist for wallet', async () => {
        expect(await repo.findLatestByWalletAddress('GNONE')).toBeNull();
      });
    });

    // --- findByWalletAddress ---------------------------------------------

    describe('findByWalletAddress', () => {
      it('returns only records for the given wallet', async () => {
        await repo.save(sampleEvaluation({ walletAddress: WALLET }));
        await repo.save(sampleEvaluation({ walletAddress: WALLET2 }));

        const results = await repo.findByWalletAddress(WALLET);
        expect(results).toHaveLength(1);
        expect(results[0].walletAddress).toBe(WALLET);
      });
    });

    // --- isValid ----------------------------------------------------------

    describe('isValid', () => {
      it('returns true when evaluation has not expired', async () => {
        await repo.save(sampleEvaluation({ expiresAt: futureDate(3_600_000) }));
        expect(await repo.isValid(WALLET)).toBe(true);
      });

      it('returns false when evaluation has expired', async () => {
        await repo.save(sampleEvaluation({ expiresAt: pastDate(1000) }));
        expect(await repo.isValid(WALLET)).toBe(false);
      });

      it('returns false when no evaluation exists', async () => {
        expect(await repo.isValid('GNONE')).toBe(false);
      });
    });

    // --- deleteExpired ----------------------------------------------------

    describe('deleteExpired', () => {
      it('removes expired evaluations and returns the count', async () => {
        await repo.save(sampleEvaluation({ expiresAt: pastDate(1000) })); // expired
        await repo.save(sampleEvaluation({ expiresAt: futureDate(3_600_000) })); // valid

        const deleted = await repo.deleteExpired();
        expect(deleted).toBe(1);
        expect(await repo.count()).toBe(1);
      });

      it('returns 0 when nothing is expired', async () => {
        await repo.save(sampleEvaluation({ expiresAt: futureDate(3_600_000) }));
        expect(await repo.deleteExpired()).toBe(0);
      });
    });

    // --- findAll / count -------------------------------------------------

    describe('findAll and count', () => {
      it('count starts at 0', async () => {
        expect(await repo.count()).toBe(0);
      });

      it('count increments on save', async () => {
        await repo.save(sampleEvaluation());
        expect(await repo.count()).toBe(1);
        await repo.save(sampleEvaluation());
        expect(await repo.count()).toBe(2);
      });

      it('findAll respects limit', async () => {
        for (let i = 0; i < 4; i++) await repo.save(sampleEvaluation());
        expect(await repo.findAll(0, 2)).toHaveLength(2);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Register implementations
// ---------------------------------------------------------------------------

runRiskEvaluationRepositoryContract('InMemory', () => new InMemoryRiskEvaluationRepository());

// Postgres variant activated via DATABASE_URL in CI:
// if (process.env.DATABASE_URL) {
//   runRiskEvaluationRepositoryContract('Postgres', () => new PostgresRiskEvaluationRepository(pool));
// }
