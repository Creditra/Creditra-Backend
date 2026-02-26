export type CreditLineStatus = "active" | "suspended" | "closed";

export interface CreditLineEvent {
  action: "created" | "suspended" | "closed";
  timestamp: string;
  actor?: string;
}

export interface CreditLine {
  id: string;
  borrowerId: string;
  creditLimit: number;
  interestRateBps: number;
  currency: string;
  riskScore?: number;
  evaluationId?: string;
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

export class InvalidCreditLineInputError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`Invalid input for "${field}": ${reason}`);
    this.name = "InvalidCreditLineInputError";
  }
}

export interface CreateCreditLineInput {
  borrowerId: string;
  initialLimit: number;
  interestRateBps: number;
  currency?: string;
  riskScore?: number;
  evaluationId?: string;
}

export const _store = new Map<string, CreditLine>();

export function _resetStore(): void {
  _store.clear();
}

function now(): string {
  return new Date().toISOString();
}

export function createCreditLine(
  input: CreateCreditLineInput | string,
  status: CreditLineStatus = "active",
): CreditLine {
  const ts = now();

  // Legacy signature: createCreditLine(id, status)
  if (typeof input === "string") {
    const id = input;
    const line: CreditLine = {
      id,
      borrowerId: "",
      creditLimit: 0,
      interestRateBps: 0,
      currency: "USDC",
      status,
      createdAt: ts,
      updatedAt: ts,
      events: [{ action: "created", timestamp: ts }],
    };
    _store.set(id, line);
    return line;
  }

  // New signature: createCreditLine(CreateCreditLineInput)
  const {
    borrowerId,
    initialLimit,
    interestRateBps,
    currency,
    riskScore,
    evaluationId,
  } = input;

  // Validation
  if (!borrowerId || borrowerId.trim() === "") {
    throw new InvalidCreditLineInputError(
      "borrowerId",
      "borrowerId is required and cannot be empty",
    );
  }
  if (typeof initialLimit !== "number" || initialLimit <= 0) {
    throw new InvalidCreditLineInputError(
      "initialLimit",
      "initialLimit must be a positive number",
    );
  }
  if (typeof interestRateBps !== "number" || interestRateBps < 0) {
    throw new InvalidCreditLineInputError(
      "interestRateBps",
      "interestRateBps must be a non-negative number",
    );
  }
  if (
    riskScore !== undefined &&
    (typeof riskScore !== "number" || riskScore < 0 || riskScore > 100)
  ) {
    throw new InvalidCreditLineInputError(
      "riskScore",
      "riskScore must be a number between 0 and 100",
    );
  }

  const id = crypto.randomUUID();
  const line: CreditLine = {
    id,
    borrowerId: borrowerId.trim(),
    creditLimit: initialLimit,
    interestRateBps,
    currency: currency ?? "USDC",
    riskScore,
    evaluationId,
    status: "active",
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
