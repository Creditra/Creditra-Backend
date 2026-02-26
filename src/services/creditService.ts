export type CreditLineStatus = "active" | "suspended" | "closed";

export interface CreditLineEvent {
    action: "created" | "suspended" | "closed" | "repayment";
    timestamp: string;
    actor?: string;
    amount?: number;
    transactionReference?: string;
}

export interface CreditLine {
    id: string;
    status: CreditLineStatus;
    creditLimit: number;
    utilizedAmount: number;
    currency: string;
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

export class InvalidRepaymentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidRepaymentError";
    }
}

export interface RepaymentRequest {
    amount: number;
    transactionReference?: string;
}

export interface RepaymentResult {
    creditLine: CreditLine;
    repaymentAmount: number;
    newUtilizedAmount: number;
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
    creditLimit: number = 1000,
    currency: string = "USDC",
    ): CreditLine {
    const ts = now();
    const line: CreditLine = {
        id,
        status,
        creditLimit,
        utilizedAmount: 0,
        currency,
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

export function repayCreditLine(id: string, request: RepaymentRequest): RepaymentResult {
    const line = _store.get(id);
    if (!line) throw new CreditLineNotFoundError(id);

    if (line.status !== "active") {
        throw new InvalidTransitionError(line.status, "repay");
    }

    if (request.amount <= 0) {
        throw new InvalidRepaymentError("Repayment amount must be positive");
    }

    if (request.amount > line.utilizedAmount) {
        throw new InvalidRepaymentError(
            `Repayment amount (${request.amount}) cannot exceed utilized amount (${line.utilizedAmount})`
        );
    }

    const ts = now();
    const newUtilizedAmount = line.utilizedAmount - request.amount;
    
    line.utilizedAmount = newUtilizedAmount;
    line.updatedAt = ts;
    line.events.push({ 
        action: "repayment", 
        timestamp: ts,
        amount: request.amount,
        transactionReference: request.transactionReference
    });

    return {
        creditLine: line,
        repaymentAmount: request.amount,
        newUtilizedAmount
    };
}