/**
 * Compliance export service.
 *
 * Loads credit lines, transactions, and audit records for a constrained
 * date window, applies optional filters, and returns a page capped by the
 * export limit. Streaming and content-type selection live in the route layer.
 */
import type { CreditLine } from '../models/CreditLine.js';
import type { Transaction } from '../models/Transaction.js';
import type { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';
import type { TransactionRepository } from '../repositories/interfaces/TransactionRepository.js';
import type { AuditLogStore } from './auditLogStore.js';
import type { AuditRecord } from './events/auditSubscriber.js';
import {
  DEFAULT_EXPORT_LIMIT,
  MAX_EXPORT_LIMIT,
  type AuditExportQuery,
  type CreditLineExportQuery,
  type TransactionExportQuery,
} from '../schemas/export.schema.js';
import { flattenForExport } from '../utils/exportStream.js';

/** Batch size when scanning repositories for filtered exports. */
const SCAN_BATCH = 500;

export interface ExportPage<T> {
  rows: T[];
  /** True when more matching rows exist beyond this page's limit. */
  truncated: boolean;
  limit: number;
  offset: number;
  from: string;
  to: string;
}

export class ComplianceExportService {
  constructor(
    private readonly creditLines: CreditLineRepository,
    private readonly transactions: TransactionRepository,
    private readonly auditStore: AuditLogStore,
  ) {}

  async exportCreditLines(query: CreditLineExportQuery): Promise<ExportPage<Record<string, unknown>>> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const limit = clampLimit(query.limit);
    const offset = query.offset ?? 0;

    const matched: CreditLine[] = [];
    let scanOffset = 0;
    // Fetch one extra past the requested page to detect truncation without a full count.
    const need = offset + limit + 1;

    while (matched.length < need) {
      const batch = await this.creditLines.findAll(scanOffset, SCAN_BATCH);
      if (batch.length === 0) break;
      scanOffset += batch.length;

      for (const line of batch) {
        if (!inRange(line.createdAt, from, to)) continue;
        if (query.status && line.status !== query.status) continue;
        if (query.walletAddress && line.walletAddress !== query.walletAddress) continue;
        matched.push(line);
        if (matched.length >= need) break;
      }

      if (batch.length < SCAN_BATCH) break;
    }

    const page = matched.slice(offset, offset + limit);
    const truncated = matched.length > offset + limit;

    return {
      rows: page.map((line) => flattenForExport(serializeCreditLine(line))),
      truncated,
      limit,
      offset,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async exportTransactions(
    query: TransactionExportQuery,
  ): Promise<ExportPage<Record<string, unknown>>> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const limit = clampLimit(query.limit);
    const offset = query.offset ?? 0;

    const matched: Transaction[] = [];
    let scanOffset = 0;
    const need = offset + limit + 1;

    while (matched.length < need) {
      const batch = await this.transactions.findAll(scanOffset, SCAN_BATCH);
      if (batch.length === 0) break;
      scanOffset += batch.length;

      for (const tx of batch) {
        if (!inRange(tx.createdAt, from, to)) continue;
        if (query.status && tx.status !== query.status) continue;
        if (query.type && tx.type !== query.type) continue;
        if (query.creditLineId && tx.creditLineId !== query.creditLineId) continue;
        if (query.walletAddress && tx.walletAddress !== query.walletAddress) continue;
        matched.push(tx);
        if (matched.length >= need) break;
      }

      if (batch.length < SCAN_BATCH) break;
    }

    const page = matched.slice(offset, offset + limit);
    const truncated = matched.length > offset + limit;

    return {
      rows: page.map((tx) => flattenForExport(serializeTransaction(tx))),
      truncated,
      limit,
      offset,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  exportAudit(query: AuditExportQuery): ExportPage<Record<string, unknown>> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const limit = clampLimit(query.limit);
    const offset = query.offset ?? 0;

    // Fetch one extra row to signal truncation.
    const records = this.auditStore.query({
      from,
      to,
      action: query.action,
      creditLineId: query.creditLineId,
      offset,
      limit: limit + 1,
    });

    const truncated = records.length > limit;
    const page = truncated ? records.slice(0, limit) : records;

    return {
      rows: page.map((record) => flattenForExport(serializeAudit(record))),
      truncated,
      limit,
      offset,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }
}

function clampLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_EXPORT_LIMIT;
  return Math.min(Math.max(1, value), MAX_EXPORT_LIMIT);
}

function inRange(date: Date, from: Date, to: Date): boolean {
  const ms = date.getTime();
  return ms >= from.getTime() && ms <= to.getTime();
}

function serializeCreditLine(line: CreditLine): Record<string, unknown> {
  return {
    id: line.id,
    walletAddress: line.walletAddress,
    creditLimit: line.creditLimit,
    availableCredit: line.availableCredit,
    utilized: line.utilized,
    interestRateBps: line.interestRateBps,
    status: line.status,
    version: line.version ?? null,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

function serializeTransaction(tx: Transaction): Record<string, unknown> {
  return {
    id: tx.id,
    creditLineId: tx.creditLineId,
    walletAddress: tx.walletAddress,
    amount: tx.amount,
    type: tx.type,
    status: tx.status,
    blockchainTxHash: tx.blockchainTxHash ?? null,
    createdAt: tx.createdAt.toISOString(),
    processedAt: tx.processedAt ? tx.processedAt.toISOString() : null,
  };
}

function serializeAudit(record: AuditRecord): Record<string, unknown> {
  return {
    action: record.action,
    creditLineId: record.creditLineId,
    occurredAt: record.occurredAt,
    details: record.details,
  };
}

/** Stable column order for CSV exports. */
export const CREDIT_LINE_CSV_COLUMNS = [
  'id',
  'walletAddress',
  'creditLimit',
  'availableCredit',
  'utilized',
  'interestRateBps',
  'status',
  'version',
  'createdAt',
  'updatedAt',
] as const;

export const TRANSACTION_CSV_COLUMNS = [
  'id',
  'creditLineId',
  'walletAddress',
  'amount',
  'type',
  'status',
  'blockchainTxHash',
  'createdAt',
  'processedAt',
] as const;

export const AUDIT_CSV_COLUMNS = [
  'action',
  'creditLineId',
  'occurredAt',
  'details',
] as const;
