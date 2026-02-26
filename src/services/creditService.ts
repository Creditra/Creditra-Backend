
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

export const _store = new Map<string, Map<string, CreditLine>>();

export function _resetStore(): void {
    _store.clear();
}

function getTenantStore(tenantId: string): Map<string, CreditLine> {
    let tenantStore = _store.get(tenantId);
    if (!tenantStore) {
        tenantStore = new Map<string, CreditLine>();
        _store.set(tenantId, tenantStore);
    }
    return tenantStore;
}

function now(): string {
    return new Date().toISOString();
}

export function createCreditLine(
    tenantId: string,
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
    getTenantStore(tenantId).set(id, line);
    return line;
}

export function getCreditLine(
    tenantId: string,
    id: string,
): CreditLine | undefined {
    return _store.get(tenantId)?.get(id);
}

export function listCreditLines(tenantId: string): CreditLine[] {
    return Array.from(_store.get(tenantId)?.values() ?? []);
}

export function suspendCreditLine(tenantId: string, id: string): CreditLine {
    const line = _store.get(tenantId)?.get(id);
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

export function closeCreditLine(tenantId: string, id: string): CreditLine {
    const line = _store.get(tenantId)?.get(id);
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
