import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryCreditLineRepository,
  ICreditLineRepository,
} from './creditLineRepository.js';
import { CreditLine, CreditLineStatus } from '../models/creditLine.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

const MOCK_LINES: CreditLine[] = [
  {
    id: 'test-id-001',
    borrowerId: 'borrower-001',
    limitCents: 10_000_00,
    utilizedCents: 1_000_00,
    interestRateBps: 1000,
    riskScore: 0.2,
    status: CreditLineStatus.Active,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  },
  {
    id: 'test-id-002',
    borrowerId: 'borrower-002',
    limitCents: 20_000_00,
    utilizedCents: 20_000_00,
    interestRateBps: 2000,
    riskScore: 0.75,
    status: CreditLineStatus.Suspended,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  },
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe('InMemoryCreditLineRepository', () => {
  let repo: ICreditLineRepository;

  beforeEach(() => {
    repo = new InMemoryCreditLineRepository(MOCK_LINES);
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all seeded credit lines', async () => {
      const result = await repo.findAll();
      expect(result).toHaveLength(2);
    });

    it('returns a plain array (not the internal Map)', async () => {
      const result = await repo.findAll();
      expect(Array.isArray(result)).toBe(true);
    });

    it('includes the correct ids', async () => {
      const result = await repo.findAll();
      const ids = result.map((cl) => cl.id);
      expect(ids).toContain('test-id-001');
      expect(ids).toContain('test-id-002');
    });

    it('returns CreditLine objects with all required fields', async () => {
      const [first] = await repo.findAll();
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('borrowerId');
      expect(first).toHaveProperty('limitCents');
      expect(first).toHaveProperty('utilizedCents');
      expect(first).toHaveProperty('interestRateBps');
      expect(first).toHaveProperty('riskScore');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('createdAt');
      expect(first).toHaveProperty('updatedAt');
    });

    it('returns an empty array when seeded with no records', async () => {
      const emptyRepo = new InMemoryCreditLineRepository([]);
      const result = await emptyRepo.findAll();
      expect(result).toEqual([]);
    });

    it('resolves (is async)', async () => {
      await expect(repo.findAll()).resolves.toBeDefined();
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('returns the matching credit line for a known id', async () => {
      const result = await repo.findById('test-id-001');
      expect(result).toBeDefined();
      expect(result!.id).toBe('test-id-001');
      expect(result!.borrowerId).toBe('borrower-001');
    });

    it('returns undefined for an unknown id', async () => {
      const result = await repo.findById('does-not-exist');
      expect(result).toBeUndefined();
    });

    it('returns the correct record for the second seeded entry', async () => {
      const result = await repo.findById('test-id-002');
      expect(result).toBeDefined();
      expect(result!.status).toBe(CreditLineStatus.Suspended);
      expect(result!.riskScore).toBe(0.75);
    });

    it('resolves (is async)', async () => {
      await expect(repo.findById('test-id-001')).resolves.toBeDefined();
    });

    it('is case-sensitive for id lookup', async () => {
      const result = await repo.findById('TEST-ID-001');
      expect(result).toBeUndefined();
    });
  });
});