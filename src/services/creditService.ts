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

export function _resetStore(): void {
    _store.clear();
}

function now(): string {
    return new Date().toISOString();
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

    return line;
}