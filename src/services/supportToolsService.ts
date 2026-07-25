/**
 * Read-only support tools service.
 *
 * Aggregates borrower troubleshooting views for incident response without
 * any write side-effects: no credit-line mutations, no job scheduling, and
 * no reconciliation triggers. All methods only call repository/service
 * getters and pure transforms.
 *
 * Surface consumed by {@link supportRouter}:
 * - {@link getBorrowerLookup} — credit-line snapshots + recent txs + recon status
 * - {@link getCreditLineSnapshot} — single credit-line snapshot
 * - {@link getRecentTransactions} — recent txs for a credit line
 * - {@link getReconciliationStatus} — worker/queue health (read-only)
 */

import type { CreditLine } from '../models/CreditLine.js';
import type { Transaction } from '../models/Transaction.js';
import type { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';
import type { TransactionRepository } from '../repositories/interfaces/TransactionRepository.js';
import type { JobQueue } from './jobQueue.js';
import { redactSupportValue } from '../utils/supportRedact.js';

const DEFAULT_RECENT_TX_LIMIT = 20;
const MAX_RECENT_TX_LIMIT = 100;

export interface CreditLineSnapshot {
  id: string;
  walletAddress: string;
  creditLimit: string;
  availableCredit: string;
  utilized: string;
  interestRateBps: number;
  status: string;
  version: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionSnapshot {
  id: string;
  creditLineId: string;
  walletAddress: string;
  amount: string;
  type: string;
  status: string;
  blockchainTxHash: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface ReconciliationControlPlaneStatus {
  /** Whether the background reconciliation worker interval is active. */
  workerRunning: boolean;
  /** Pending jobs in the in-process queue (not yet completed). */
  queueSize: number;
  /** Dead-letter / permanently failed job count. */
  failedJobs: number;
  /**
   * Explicit marker that this payload is observational only —
   * support tools never schedule reconciliation.
   */
  readOnly: true;
}

export interface BorrowerLookupResult {
  walletAddress: string;
  creditLines: CreditLineSnapshot[];
  recentTransactions: TransactionSnapshot[];
  reconciliation: ReconciliationControlPlaneStatus;
  generatedAt: string;
  /** True when no credit lines exist for the wallet (not an error). */
  found: boolean;
}

export interface CreditLineLookupResult {
  creditLine: CreditLineSnapshot;
  recentTransactions: TransactionSnapshot[];
  reconciliation: ReconciliationControlPlaneStatus;
  generatedAt: string;
}

export interface SupportToolsServiceDeps {
  creditLineRepository: CreditLineRepository;
  transactionRepository: TransactionRepository;
  reconciliationWorker: { isRunning(): boolean };
  jobQueue: Pick<JobQueue, 'size' | 'getFailedJobs'>;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export class SupportToolsService {
  private readonly now: () => Date;

  constructor(private readonly deps: SupportToolsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Full borrower troubleshooting view: credit lines, recent txs, recon status.
   * Read-only. Returns `found: false` when the wallet has no credit lines
   * (still 200 at the route layer so support can distinguish "empty" from 404
   * on a single-line lookup).
   */
  async getBorrowerLookup(
    walletAddress: string,
    recentTxLimit = DEFAULT_RECENT_TX_LIMIT,
  ): Promise<BorrowerLookupResult> {
    const limit = clampLimit(recentTxLimit);
    const lines = await this.deps.creditLineRepository.findByWalletAddress(walletAddress);
    const txs = await this.deps.transactionRepository.findByWalletAddress(
      walletAddress,
      0,
      limit,
    );

    const payload: BorrowerLookupResult = {
      walletAddress,
      creditLines: lines.map(toCreditLineSnapshot),
      recentTransactions: txs.map(toTransactionSnapshot),
      reconciliation: this.getReconciliationStatus(),
      generatedAt: this.now().toISOString(),
      found: lines.length > 0,
    };

    return redactSupportValue(payload);
  }

  /**
   * Single credit-line snapshot + recent txs + recon status.
   * @returns null when the credit line does not exist
   */
  async getCreditLineLookup(
    creditLineId: string,
    recentTxLimit = DEFAULT_RECENT_TX_LIMIT,
  ): Promise<CreditLineLookupResult | null> {
    const limit = clampLimit(recentTxLimit);
    const line = await this.deps.creditLineRepository.findById(creditLineId);
    if (!line) {
      return null;
    }

    const txs = await this.deps.transactionRepository.findByCreditLineId(
      creditLineId,
      0,
      limit,
    );

    const payload: CreditLineLookupResult = {
      creditLine: toCreditLineSnapshot(line),
      recentTransactions: txs.map(toTransactionSnapshot),
      reconciliation: this.getReconciliationStatus(),
      generatedAt: this.now().toISOString(),
    };

    return redactSupportValue(payload);
  }

  /** Recent transactions for a credit line (empty list if line missing is caller's concern). */
  async getRecentTransactions(
    creditLineId: string,
    limit = DEFAULT_RECENT_TX_LIMIT,
  ): Promise<TransactionSnapshot[] | null> {
    const exists = await this.deps.creditLineRepository.exists(creditLineId);
    if (!exists) {
      return null;
    }

    const txs = await this.deps.transactionRepository.findByCreditLineId(
      creditLineId,
      0,
      clampLimit(limit),
    );

    return redactSupportValue(txs.map(toTransactionSnapshot));
  }

  /**
   * Control-plane reconciliation status. Pure observation — never enqueues jobs.
   */
  getReconciliationStatus(): ReconciliationControlPlaneStatus {
    return {
      workerRunning: this.deps.reconciliationWorker.isRunning(),
      queueSize: this.deps.jobQueue.size(),
      failedJobs: this.deps.jobQueue.getFailedJobs().length,
      readOnly: true,
    };
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_RECENT_TX_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_RECENT_TX_LIMIT);
}

function toCreditLineSnapshot(line: CreditLine): CreditLineSnapshot {
  return {
    id: line.id,
    walletAddress: line.walletAddress,
    creditLimit: line.creditLimit,
    availableCredit: line.availableCredit,
    utilized: line.utilized,
    interestRateBps: line.interestRateBps,
    status: line.status,
    version: line.version ?? null,
    createdAt: toIso(line.createdAt),
    updatedAt: toIso(line.updatedAt),
  };
}

function toTransactionSnapshot(tx: Transaction): TransactionSnapshot {
  return {
    id: tx.id,
    creditLineId: tx.creditLineId,
    walletAddress: tx.walletAddress,
    amount: tx.amount,
    type: tx.type,
    status: tx.status,
    blockchainTxHash: tx.blockchainTxHash ?? null,
    createdAt: toIso(tx.createdAt),
    processedAt: tx.processedAt ? toIso(tx.processedAt) : null,
  };
}

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export { DEFAULT_RECENT_TX_LIMIT, MAX_RECENT_TX_LIMIT };
