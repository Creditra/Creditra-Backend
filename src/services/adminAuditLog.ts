import { createHash, randomUUID } from 'node:crypto';

export interface AuditTarget {
  type: string;
  id?: string;
}

export interface AdminAuditRecordInput {
  actor: string;
  action: string;
  target: AuditTarget;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
}

export interface AdminAuditRecord {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  correlationId: string;
  createdAt: string;
  previousHash: string | null;
  hash: string;
}

export interface AdminAuditQuery {
  limit?: number;
  cursor?: string;
  actor?: string;
  action?: string;
  targetType?: string;
}

export interface AdminAuditPage {
  items: AdminAuditRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(authorization|secret|password|plaintext|token|api[-_]?key|private[-_]?key|seed|mnemonic)/i;

export function actorFingerprint(actorSecret: string): string {
  const digest = createHash('sha256').update(actorSecret, 'utf8').digest('hex').slice(0, 16);
  return `sha256:${digest}`;
}

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactAuditValue(nested),
      ]),
    );
  }

  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function computeHash(record: Omit<AdminAuditRecord, 'hash'>): string {
  return createHash('sha256').update(stableStringify(record), 'utf8').digest('hex');
}

export class AdminAuditLog {
  private readonly records: AdminAuditRecord[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(input: AdminAuditRecordInput): AdminAuditRecord {
    const previousHash = this.records.at(-1)?.hash ?? null;
    const withoutHash: Omit<AdminAuditRecord, 'hash'> = {
      id: randomUUID(),
      actor: input.actor,
      action: input.action,
      targetType: input.target.type,
      targetId: input.target.id ?? null,
      before: redactAuditValue(input.before),
      after: redactAuditValue(input.after),
      correlationId: input.correlationId ?? randomUUID(),
      createdAt: this.now().toISOString(),
      previousHash,
    };
    const record = Object.freeze({
      ...withoutHash,
      hash: computeHash(withoutHash),
    });
    this.records.push(record);
    return record;
  }

  list(query: AdminAuditQuery = {}): AdminAuditPage {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const start = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
    const offset = Number.isFinite(start) && start > 0 ? start : 0;
    const filtered = this.records
      .filter((record) => !query.actor || record.actor === query.actor)
      .filter((record) => !query.action || record.action === query.action)
      .filter((record) => !query.targetType || record.targetType === query.targetType)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;

    return {
      items,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      hasMore: nextOffset < filtered.length,
    };
  }

  resetForTests(): void {
    this.records.length = 0;
  }
}

export const defaultAdminAuditLog = new AdminAuditLog();
