/**
 * Append-only in-process audit log store for compliance exports.
 *
 * The {@link registerAuditSubscriber} sink writes here so admin export
 * endpoints can stream filtered audit history without requiring Postgres
 * (tests and local dev use the same path). Production deployments may
 * replace this with a table-backed sink while keeping the query surface.
 *
 * A hard cap on retained rows prevents unbounded memory growth; the oldest
 * records are dropped when the cap is exceeded (ring-buffer semantics).
 */
import type { AuditRecord } from './events/auditSubscriber.js';

/** Default max retained audit records in process memory. */
export const DEFAULT_AUDIT_STORE_CAPACITY = 50_000;

export interface AuditQuery {
  /** Inclusive lower bound on `occurredAt` (ISO-8601). */
  from?: Date;
  /** Inclusive upper bound on `occurredAt` (ISO-8601). */
  to?: Date;
  /** Exact credit-line filter. */
  creditLineId?: string;
  /** Exact action / event-type filter. */
  action?: string;
  /** Pagination offset. */
  offset?: number;
  /** Max rows to return (caller enforces export ceiling). */
  limit?: number;
}

export class AuditLogStore {
  private readonly records: AuditRecord[] = [];

  constructor(private readonly capacity: number = DEFAULT_AUDIT_STORE_CAPACITY) {
    if (capacity < 1) {
      throw new Error('AuditLogStore capacity must be at least 1');
    }
  }

  /** Append a record. Drops the oldest entry when over capacity. */
  append(record: AuditRecord): void {
    this.records.push(record);
    while (this.records.length > this.capacity) {
      this.records.shift();
    }
  }

  /** Sink adapter for {@link registerAuditSubscriber}. */
  sink = (record: AuditRecord): void => {
    this.append(record);
  };

  /**
   * Query records newest-first with optional filters.
   * Returns a shallow copy of the matching page.
   */
  query(options: AuditQuery = {}): AuditRecord[] {
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit ?? this.records.length;

    const matched = this.records
      .filter((record) => matchesAuditFilters(record, options))
      .sort((a, b) => {
        const ts = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
        if (ts !== 0) return ts;
        return a.creditLineId.localeCompare(b.creditLineId);
      });

    return matched.slice(offset, offset + limit);
  }

  /** Count of records matching the filters (ignores pagination). */
  count(options: Omit<AuditQuery, 'offset' | 'limit'> = {}): number {
    return this.records.filter((record) => matchesAuditFilters(record, options)).length;
  }

  /** Test helper — wipe all records. */
  clear(): void {
    this.records.length = 0;
  }

  /** Current retained size (for diagnostics/tests). */
  size(): number {
    return this.records.length;
  }
}

function matchesAuditFilters(
  record: AuditRecord,
  options: Pick<AuditQuery, 'from' | 'to' | 'creditLineId' | 'action'>,
): boolean {
  const occurredMs = Date.parse(record.occurredAt);
  if (Number.isNaN(occurredMs)) return false;

  if (options.from && occurredMs < options.from.getTime()) return false;
  if (options.to && occurredMs > options.to.getTime()) return false;
  if (options.creditLineId && record.creditLineId !== options.creditLineId) return false;
  if (options.action && record.action !== options.action) return false;
  return true;
}

/** Process-wide default store used by the event bus and export routes. */
export const defaultAuditLogStore = new AuditLogStore();
