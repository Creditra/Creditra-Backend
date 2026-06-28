import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '../../../db/client.js';
import { PostgresTransactionRepository } from '../PostgresTransactionRepository.js';
import { PostgresRiskEvaluationRepository } from '../PostgresRiskEvaluationRepository.js';
import { TransactionStatus, TransactionType } from '../../../models/Transaction.js';

function createMockClient(overrides: Partial<DbClient> = {}): DbClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PostgresTransactionRepository', () => {
  let client: DbClient;
  let repo: PostgresTransactionRepository;
  const now = new Date();

  beforeEach(() => {
    client = createMockClient();
    repo = new PostgresTransactionRepository(client);
  });

  it('creates a transaction with parameterized values', async () => {
    vi.mocked(client.query)
      // INSERT ... RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] })
      // findById select
      .mockResolvedValueOnce({
        rows: [{
          id: 'tx-1',
          credit_line_id: 'cl-1',
          wallet_address: 'GTEST',
          amount: '100.00',
          type: 'borrow',
          status: 'pending',
          blockchain_tx_hash: null,
          created_at: now,
          processed_at: null,
        }],
      });

    const result = await repo.create({
      creditLineId: 'cl-1',
      amount: '100.00',
      type: TransactionType.BORROW,
    });

    expect(result.id).toBe('tx-1');
    expect(result.walletAddress).toBe('GTEST');
    expect(result.status).toBe(TransactionStatus.PENDING);
    // No string interpolation: values are passed as a parameter array.
    const insertCall = vi.mocked(client.query).mock.calls[0];
    expect(Array.isArray(insertCall[1])).toBe(true);
  });

  it('updates status and returns null when not found', async () => {
    vi.mocked(client.query).mockResolvedValueOnce({ rows: [] });
    const result = await repo.updateStatus('missing', TransactionStatus.CONFIRMED);
    expect(result).toBeNull();
  });

  it('counts transactions', async () => {
    vi.mocked(client.query).mockResolvedValueOnce({ rows: [{ count: '7' }] });
    expect(await repo.count()).toBe(7);
  });

  it('filters by status', async () => {
    vi.mocked(client.query).mockResolvedValueOnce({ rows: [] });
    await repo.findByStatus(TransactionStatus.FAILED);
    const [, values] = vi.mocked(client.query).mock.calls[0];
    expect(values?.[0]).toBe(TransactionStatus.FAILED);
  });
});

describe('PostgresRiskEvaluationRepository', () => {
  let client: DbClient;
  let repo: PostgresRiskEvaluationRepository;
  const evaluatedAt = new Date('2025-01-01T00:00:00.000Z');
  const expiresAt = new Date('2025-01-02T00:00:00.000Z');

  beforeEach(() => {
    client = createMockClient();
    repo = new PostgresRiskEvaluationRepository(client);
  });

  it('saves an evaluation, ensuring borrower exists', async () => {
    vi.mocked(client.query)
      // ensureBorrower lookup (found)
      .mockResolvedValueOnce({ rows: [{ id: 'b-1' }] })
      // INSERT ... RETURNING
      .mockResolvedValueOnce({
        rows: [{
          id: 're-1',
          risk_score: 42,
          suggested_limit: '5000.00',
          interest_rate_bps: 500,
          inputs: [{ name: 'utilization', value: 0.2, weight: 1 }],
          evaluated_at: evaluatedAt,
          expires_at: expiresAt,
        }],
      });

    const result = await repo.save({
      walletAddress: 'GTEST',
      riskScore: 42,
      creditLimit: '5000.00',
      interestRateBps: 500,
      factors: [{ name: 'utilization', value: 0.2, weight: 1 }],
      evaluatedAt,
      expiresAt,
    });

    expect(result.id).toBe('re-1');
    expect(result.creditLimit).toBe('5000.00');
    expect(result.factors).toHaveLength(1);
    expect(result.expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it('isValid is false when no evaluation exists', async () => {
    vi.mocked(client.query).mockResolvedValueOnce({ rows: [] });
    expect(await repo.isValid('GTEST')).toBe(false);
  });

  it('deleteExpired returns affected row count', async () => {
    vi.mocked(client.query).mockResolvedValueOnce({ rows: [], rowCount: 3 } as never);
    expect(await repo.deleteExpired()).toBe(3);
  });
});
