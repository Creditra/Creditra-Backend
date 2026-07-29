/**
 * Append-only persistence for credit lifecycle domain events.
 *
 * Backs the `domain_events` table (see `migrations/009_domain_events.sql`) so the
 * full lifecycle history can be replayed for reconciliation and audits, independent
 * of the in-process {@link EventBus} (which does not survive a process crash).
 *
 * Idempotency: `(aggregateId, eventType, occurredAt)` is a unique key. Re-appending
 * the same domain event (e.g. after a crash-before-ack retry) is a no-op, not a
 * duplicate row — callers do not need their own dedup logic.
 *
 * See `docs/ARCHITECTURE.md` §3 (eventing) for delivery semantics; this store is the
 * durable replay log, the {@link EventBus} is the in-process fan-out.
 */
import type { DbClient } from '../db/client.js';
import type { CreditDomainEvent } from './events/domainEvents.js';

export interface DomainEventRecord {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: string;
  createdAt: string;
}

export interface DomainEventQuery {
  aggregateId?: string;
  eventType?: string;
  offset?: number;
  limit?: number;
}

export interface DomainEventStore {
  /** Append one domain event. Idempotent: a duplicate (aggregateId, type, occurredAt) is a no-op. */
  append(event: CreditDomainEvent): Promise<void>;
  /** Replay events oldest-first, optionally filtered. */
  list(query?: DomainEventQuery): Promise<DomainEventRecord[]>;
}

function toRecord(row: Record<string, unknown>): DomainEventRecord {
  return {
    id: row.id as string,
    eventType: row.event_type as string,
    aggregateId: row.aggregate_id as string,
    payload: row.payload,
    occurredAt: new Date(row.occurred_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export class PostgresDomainEventStore implements DomainEventStore {
  constructor(private readonly db: DbClient) {}

  async append(event: CreditDomainEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO domain_events (event_type, aggregate_id, payload, occurred_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (aggregate_id, event_type, occurred_at) DO NOTHING`,
      [event.type, event.creditLineId, JSON.stringify(event.payload), event.occurredAt],
    );
  }

  async list(query: DomainEventQuery = {}): Promise<DomainEventRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.aggregateId) {
      values.push(query.aggregateId);
      conditions.push(`aggregate_id = $${values.length}`);
    }
    if (query.eventType) {
      values.push(query.eventType);
      conditions.push(`event_type = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(query.limit ?? 100);
    const limitParam = `$${values.length}`;
    values.push(query.offset ?? 0);
    const offsetParam = `$${values.length}`;

    const result = await this.db.query(
      `SELECT id, event_type, aggregate_id, payload, occurred_at, created_at
       FROM domain_events
       ${where}
       ORDER BY occurred_at ASC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    );
    return result.rows.map((row) => toRecord(row as Record<string, unknown>));
  }
}

/** In-memory fallback used in tests/local dev without a configured database. */
export class InMemoryDomainEventStore implements DomainEventStore {
  private readonly seen = new Set<string>();
  private readonly records: DomainEventRecord[] = [];
  private counter = 0;

  private dedupeKey(event: CreditDomainEvent): string {
    return `${event.creditLineId}::${event.type}::${event.occurredAt}`;
  }

  async append(event: CreditDomainEvent): Promise<void> {
    const key = this.dedupeKey(event);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.counter += 1;
    this.records.push({
      id: `mem-${this.counter}`,
      eventType: event.type,
      aggregateId: event.creditLineId,
      payload: event.payload,
      occurredAt: event.occurredAt,
      createdAt: new Date().toISOString(),
    });
  }

  async list(query: DomainEventQuery = {}): Promise<DomainEventRecord[]> {
    const offset = Math.max(0, query.offset ?? 0);
    const limit = query.limit ?? this.records.length;
    return this.records
      .filter((r) => !query.aggregateId || r.aggregateId === query.aggregateId)
      .filter((r) => !query.eventType || r.eventType === query.eventType)
      .slice(offset, offset + limit);
  }

  /** Test-only helper to reset state between cases. */
  clear(): void {
    this.seen.clear();
    this.records.length = 0;
    this.counter = 0;
  }
}
