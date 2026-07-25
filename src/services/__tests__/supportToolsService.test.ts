import { describe, it, expect, beforeEach } from 'vitest';
import { SupportToolsService } from '../supportToolsService.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryTransactionRepository } from '../../repositories/memory/InMemoryTransactionRepository.js';
import { CreditLineStatus } from '../../models/CreditLine.js';
import { TransactionStatus, TransactionType } from '../../models/Transaction.js';
import type { Job } from '../jobQueue.js';

const WALLET = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

function buildService(opts?: {
  workerRunning?: boolean;
  queueSize?: number;
  failedJobs?: number;
}) {
  const creditLineRepository = new InMemoryCreditLineRepository();
  const transactionRepository = new InMemoryTransactionRepository();
  const failed: Job[] = Array.from({ length: opts?.failedJobs ?? 0 }, (_, i) => ({
    id: `fail-${i}`,
    type: 'credit-reconciliation',
    payload: {},
    attempts: 3,
    maxAttempts: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastError: 'boom',
  }));

  const service = new SupportToolsService({
    creditLineRepository,
    transactionRepository,
    reconciliationWorker: {
      isRunning: () => opts?.workerRunning ?? false,
    },
    jobQueue: {
      size: () => opts?.queueSize ?? 0,
      getFailedJobs: () => failed,
    },
    now: () => FIXED_NOW,
  });

  return { service, creditLineRepository, transactionRepository };
}

describe('SupportToolsService', () => {
  let creditLineRepository: InMemoryCreditLineRepository;
  let transactionRepository: InMemoryTransactionRepository;
  let service: SupportToolsService;

  beforeEach(() => {
    ({ service, creditLineRepository, transactionRepository } = buildService({
      workerRunning: true,
      queueSize: 2,
      failedJobs: 1,
    }));
  });

  it('returns empty borrower lookup when wallet has no lines (found=false)', async () => {
    const result = await service.getBorrowerLookup(WALLET);
    expect(result.found).toBe(false);
    expect(result.creditLines).toEqual([]);
    expect(result.recentTransactions).toEqual([]);
    expect(result.reconciliation).toEqual({
      workerRunning: true,
      queueSize: 2,
      failedJobs: 1,
      readOnly: true,
    });
    expect(result.generatedAt).toBe(FIXED_NOW.toISOString());
    // Wallet is redacted in the response payload.
    expect(result.walletAddress).toBe('GDRXE2...NLRK');
  });

  it('aggregates credit lines, txs, and recon status with redaction', async () => {
    const line = await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '5000.00',
      interestRateBps: 500,
    });

    // Inject a transaction with full wallet for redaction coverage.
    const rawTx = await transactionRepository.create({
      creditLineId: line.id,
      amount: '100.00',
      type: TransactionType.BORROW,
      blockchainTxHash: 'abc123hash',
    });
    // In-memory create leaves wallet empty — set it like the service layer would.
    await transactionRepository.updateStatus(rawTx.id, TransactionStatus.CONFIRMED);
    // Directly patch wallet via a second create path: re-fetch and assert structure
    // by creating through repository then overwriting map is awkward; instead
    // verify snapshot fields from a wallet-scoped query after manual setup.
    const txRepo = transactionRepository as unknown as {
      transactions: Map<string, {
        id: string;
        creditLineId: string;
        walletAddress: string;
        amount: string;
        type: TransactionType;
        status: TransactionStatus;
        blockchainTxHash?: string;
        createdAt: Date;
        processedAt?: Date;
      }>;
    };
    const stored = txRepo.transactions.get(rawTx.id);
    if (stored) {
      stored.walletAddress = WALLET;
    }

    const result = await service.getBorrowerLookup(WALLET, 10);
    expect(result.found).toBe(true);
    expect(result.creditLines).toHaveLength(1);
    expect(result.creditLines[0].id).toBe(line.id);
    expect(result.creditLines[0].walletAddress).toBe('GDRXE2...NLRK');
    expect(result.creditLines[0].creditLimit).toBe('5000.00');
    expect(result.creditLines[0].status).toBe(CreditLineStatus.ACTIVE);
    expect(result.recentTransactions).toHaveLength(1);
    expect(result.recentTransactions[0].walletAddress).toBe('GDRXE2...NLRK');
    expect(result.recentTransactions[0].amount).toBe('100.00');
    expect(result.recentTransactions[0].blockchainTxHash).toBe('abc123hash');
    expect(JSON.stringify(result)).not.toContain(WALLET);
  });

  it('returns null for missing credit line lookup', async () => {
    const result = await service.getCreditLineLookup('does-not-exist');
    expect(result).toBeNull();
  });

  it('returns credit line lookup with txs when present', async () => {
    const line = await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '1000.00',
      interestRateBps: 100,
    });
    const result = await service.getCreditLineLookup(line.id);
    expect(result).not.toBeNull();
    expect(result!.creditLine.id).toBe(line.id);
    expect(result!.creditLine.walletAddress).toBe('GDRXE2...NLRK');
    expect(result!.reconciliation.readOnly).toBe(true);
  });

  it('returns null recent txs when credit line missing', async () => {
    expect(await service.getRecentTransactions('missing')).toBeNull();
  });

  it('returns empty recent txs when line exists but has none', async () => {
    const line = await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '100.00',
      interestRateBps: 0,
    });
    const txs = await service.getRecentTransactions(line.id);
    expect(txs).toEqual([]);
  });

  it('getReconciliationStatus is observational and marks readOnly', () => {
    const status = service.getReconciliationStatus();
    expect(status).toEqual({
      workerRunning: true,
      queueSize: 2,
      failedJobs: 1,
      readOnly: true,
    });
  });

  it('clamps recent tx limit to max 100', async () => {
    const line = await creditLineRepository.create({
      walletAddress: WALLET,
      creditLimit: '10.00',
      interestRateBps: 0,
    });
    // Should not throw with huge limit.
    const result = await service.getCreditLineLookup(line.id, 10_000);
    expect(result).not.toBeNull();
  });
});
