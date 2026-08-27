import { createHash, randomUUID } from 'node:crypto';

export type AuditValue =
  | string
  | number
  | boolean
  | null
  | AuditValue[]
  | { [key: string]: AuditValue };

export type AuditInput = {
  tenantId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  at?: number;
};

export type AuditRecord = {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, AuditValue> | null;
  after: Record<string, AuditValue> | null;
  metadata: Record<string, AuditValue> | null;
  at: number;
  previousHash: string | null;
  hash: string;
};

export type AuditIntegrityIssue = {
  recordId: string;
  code: 'HASH_MISMATCH' | 'CHAIN_BREAK' | 'TENANT_MISMATCH';
  message: string;
};

export type AuditIntegrityReport = {
  valid: boolean;
  checked: number;
  issues: AuditIntegrityIssue[];
};

export type AuditRetentionPolicy = {
  maxAgeMs: number;
  maxRecords: number;
};

export type AuditLedgerErrorCode = 'INVALID_INPUT' | 'INVALID_RETENTION_POLICY';

export class AuditLedgerError extends Error {
  readonly code: AuditLedgerErrorCode;

  constructor(code: AuditLedgerErrorCode, message: string) {
    super(message);
    this.name = 'AuditLedgerError';
    this.code = code;
  }
}

const SENSITIVE_KEY_PARTS = [
  'password',
  'secret',
  'token',
  'credential',
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'authorization',
];
const REDACTED = '[REDACTED]';

function sensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll('-', '').replaceAll(' ', '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function safeScalar(value: unknown): AuditValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string' && (/^bearer\s/i.test(value) || /^S[A-Z2-7]{50,}$/.test(value))) return REDACTED;
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  return REDACTED;
}

/** Recursively copies JSON-like state while removing credential material. */
export function redactAuditState(value: unknown): AuditValue {
  if (Array.isArray(value)) return value.map((entry) => redactAuditState(entry));
  if (value !== null && typeof value === 'object') {
    const output: Record<string, AuditValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = sensitiveKey(key) ? REDACTED : redactAuditState(nested);
    }
    return output;
  }
  return safeScalar(value);
}

function redactRecord(value: Record<string, unknown> | null | undefined): Record<string, AuditValue> | null {
  if (value === null || value === undefined) return null;
  const redacted = redactAuditState(value);
  if (typeof redacted !== 'object' || Array.isArray(redacted)) return null;
  return redacted;
}

function canonical(record: Omit<AuditRecord, 'hash'>): string {
  return JSON.stringify(record);
}

function digest(record: Omit<AuditRecord, 'hash'>): string {
  return createHash('sha256').update(canonical(record)).digest('hex');
}

function requiredText(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AuditLedgerError('INVALID_INPUT', `${field} must be non-empty`);
  }
}

function validPolicy(policy: AuditRetentionPolicy): void {
  if (!Number.isInteger(policy.maxAgeMs) || policy.maxAgeMs < 0 ||
      !Number.isInteger(policy.maxRecords) || policy.maxRecords < 1) {
    throw new AuditLedgerError('INVALID_RETENTION_POLICY', 'retention limits are invalid');
  }
}

/**
 * Append-only audit ledger. Records are exposed as defensive copies and there
 * is intentionally no update operation. Retention is an explicit policy
 * operation, separate from integrity verification.
 */
export class AuditLedger {
  private readonly records: AuditRecord[] = [];

  constructor(private readonly policy: AuditRetentionPolicy = { maxAgeMs: 365 * 24 * 60 * 60 * 1000, maxRecords: 100_000 }) {
    validPolicy(policy);
  }

  /** Rehydrates immutable records from a trusted persistence adapter for verification. */
  static fromRecords(
    records: readonly AuditRecord[],
    policy?: AuditRetentionPolicy,
  ): AuditLedger {
    const ledger = new AuditLedger(policy);
    ledger.records.push(...structuredClone(records));
    return ledger;
  }

  append(input: AuditInput): AuditRecord {
    requiredText(input.tenantId, 'tenantId');
    requiredText(input.actor, 'actor');
    requiredText(input.action, 'action');
    requiredText(input.entityType, 'entityType');
    requiredText(input.entityId, 'entityId');
    const unsigned: Omit<AuditRecord, 'hash'> = {
      id: randomUUID(),
      tenantId: input.tenantId,
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: redactRecord(input.before),
      after: redactRecord(input.after),
      metadata: redactRecord(input.metadata),
      at: input.at ?? Date.now(),
      previousHash: this.records.at(-1)?.hash ?? null,
    };
    const record = { ...unsigned, hash: digest(unsigned) };
    this.records.push(record);
    return this.copy(record);
  }

  recordFinancialMutation(input: Omit<AuditInput, 'action'> & { action: string }): AuditRecord {
    return this.append({ ...input, action: `financial.${input.action}` });
  }

  list(tenantId?: string): AuditRecord[] {
    if (tenantId !== undefined) requiredText(tenantId, 'tenantId');
    return this.records
      .filter((record) => tenantId === undefined || record.tenantId === tenantId)
      .map((record) => this.copy(record));
  }

  get size(): number {
    return this.records.length;
  }

  verify(tenantId?: string): AuditIntegrityReport {
    const records = tenantId === undefined ? this.records : this.records.filter((record) => record.tenantId === tenantId);
    const issues: AuditIntegrityIssue[] = [];
    let previousHash: string | null = tenantId === undefined ? null : null;
    for (const record of records) {
      const { hash, ...unsigned } = record;
      if (digest(unsigned) !== hash) {
        issues.push({ recordId: record.id, code: 'HASH_MISMATCH', message: 'audit record hash does not match its contents' });
      }
      if (record.previousHash !== previousHash && tenantId === undefined) {
        issues.push({ recordId: record.id, code: 'CHAIN_BREAK', message: 'audit record does not link to the preceding record' });
      }
      if (tenantId !== undefined && record.tenantId !== tenantId) {
        issues.push({ recordId: record.id, code: 'TENANT_MISMATCH', message: 'audit query crossed a tenant boundary' });
      }
      previousHash = record.hash;
    }
    return { valid: issues.length === 0, checked: records.length, issues };
  }

  /** Delete only records explicitly outside the configured retention window. */
  retain(now = Date.now()): { removed: number; remaining: number } {
    const cutoff = now - this.policy.maxAgeMs;
    const ageKept = this.records.filter((record) => record.at >= cutoff);
    const kept = ageKept.length > this.policy.maxRecords
      ? ageKept.slice(ageKept.length - this.policy.maxRecords)
      : ageKept;
    const removed = this.records.length - kept.length;
    this.records.splice(0, this.records.length, ...kept);
    return { removed, remaining: kept.length };
  }

  private copy(record: AuditRecord): AuditRecord {
    return structuredClone(record);
  }
}

export const auditLedger = new AuditLedger();
