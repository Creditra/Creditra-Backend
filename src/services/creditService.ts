import { randomUUID } from "node:crypto";
import { creditLines } from '../models/creditLineStore.js';

interface DrawRequest {
     id: string;
     borrowerId: string;
     amount: number;
}

export function drawFromCreditLine({
     id,
     borrowerId,
     amount,
}: DrawRequest) {
     const line = creditLines.find((l) => l.id === id);

     if (!line) {
          throw new Error('NOT_FOUND');
     }

     if (line.status !== 'Active') {
          throw new Error('INVALID_STATUS');
     }

     if (line.borrowerId !== borrowerId) {
          throw new Error('UNAUTHORIZED');
     }

     if (amount <= 0) {
          throw new Error('INVALID_AMOUNT');
     }

     if (line.utilized + amount > line.limit) {
          throw new Error('OVER_LIMIT');
     }

     line.utilized += amount;

     return line;
  
}

export type CreditLineStatus = "active" | "suspended" | "closed";

export interface CreditLineEvent {
    action: "created" | "suspended" | "closed";
    timestamp: string;
    actor?: string;
}

export interface CreditLine {
    id: string;
    status: CreditLineStatus;
    createdAt: string;
    updatedAt: string;
    events: CreditLineEvent[];
}

export type TransactionType = "draw" | "repayment" | "status_change";

export interface Transaction {
    id: string;
    creditLineId: string;
    type: TransactionType;
    amount: string | null;
    currency: string | null;
    timestamp: string;
    metadata: Record<string, unknown>;
}

export interface TransactionFilters {
    type?: TransactionType;
    from?: string;
    to?: string;
}

export interface PaginationOptions {
    page: number;
    limit: number;
}

export interface PaginatedTransactions {
    transactions: Transaction[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class InvalidTransitionError extends Error {
    constructor(
        public readonly currentStatus: CreditLineStatus,
        public readonly requestedAction: string,
    ) {
        super(
        `Cannot "${requestedAction}" a credit line that is already "${currentStatus}".`,
        );
        this.name = "InvalidTransitionError";
    }
}

export class CreditLineNotFoundError extends Error {
    constructor(public readonly id: string) {
        super(`Credit line "${id}" not found.`);
        this.name = "CreditLineNotFoundError";
    }
}

export const _store = new Map<string, CreditLine>();
export const _transactionStore = new Map<string, Transaction[]>();

export function _resetStore(): void {
    _store.clear();
    _transactionStore.clear();
}

function now(): string {
    return new Date().toISOString();
}

function recordTransaction(
    creditLineId: string,
    type: TransactionType,
    timestamp: string,
    amount: string | null = null,
    currency: string | null = null,
    metadata: Record<string, unknown> = {},
): void {
    const tx: Transaction = {
        id: randomUUID(),
        creditLineId,
        type,
        amount,
        currency,
        timestamp,
        metadata,
    };
    const existing = _transactionStore.get(creditLineId) ?? [];
    existing.push(tx);
    _transactionStore.set(creditLineId, existing);
}

export function createCreditLine(
    id: string,
    status: CreditLineStatus = "active",
    ): CreditLine {
    const ts = now();
    const line: CreditLine = {
        id,
        status,
        createdAt: ts,
        updatedAt: ts,
        events: [{ action: "created", timestamp: ts }],
    };
    _store.set(id, line);
    recordTransaction(id, "status_change", ts, null, null, { action: "created" });
    return line;
}

export function getCreditLine(id: string): CreditLine | undefined {
    return _store.get(id);
}

export function listCreditLines(): CreditLine[] {
    return Array.from(_store.values());
}

export function suspendCreditLine(id: string): CreditLine {
    const line = _store.get(id);
    if (!line) throw new CreditLineNotFoundError(id);

    if (line.status !== "active") {
        throw new InvalidTransitionError(line.status, "suspend");
    }

    const ts = now();
    line.status = "suspended";
    line.updatedAt = ts;
    line.events.push({ action: "suspended", timestamp: ts });
    recordTransaction(id, "status_change", ts, null, null, { action: "suspended" });

    return line;
}

export function closeCreditLine(id: string): CreditLine {
    const line = _store.get(id);
    if (!line) throw new CreditLineNotFoundError(id);

    if (line.status === "closed") {
        throw new InvalidTransitionError(line.status, "close");
    }

    const ts = now();
    line.status = "closed";
    line.updatedAt = ts;
    line.events.push({ action: "closed", timestamp: ts });
    recordTransaction(id, "status_change", ts, null, null, { action: "closed" });

    return line;
}

export function getTransactions(
    id: string,
    filters: TransactionFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 },
): PaginatedTransactions {
    if (!_store.has(id)) throw new CreditLineNotFoundError(id);

    let txs = _transactionStore.get(id) ?? [];

    if (filters.type !== undefined) {
        txs = txs.filter((tx) => tx.type === filters.type);
    }

    if (filters.from !== undefined) {
        const from = new Date(filters.from).getTime();
        txs = txs.filter((tx) => new Date(tx.timestamp).getTime() >= from);
    }

    if (filters.to !== undefined) {
        const to = new Date(filters.to).getTime();
        txs = txs.filter((tx) => new Date(tx.timestamp).getTime() <= to);
    }

    const total = txs.length;
    const { page, limit } = pagination;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const transactions = txs.slice(offset, offset + limit);

    return { transactions, total, page, limit, totalPages };
}
