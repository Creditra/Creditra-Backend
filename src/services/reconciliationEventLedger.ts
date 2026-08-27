import { createHash } from 'node:crypto';

export interface ReconciliationEvent {
  eventId: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface EventLedgerRecord {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly type: string;
  readonly payloadFingerprint: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
}

export interface EventLedgerAudit {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly kind: 'conflict' | 'rollback';
  readonly detail: string;
  readonly createdAt: Date;
}

export interface EventProcessResult<State> {
  status: 'applied' | 'replayed' | 'conflict';
  event: EventLedgerRecord | null;
  state: State;
}

export interface ReplayReport {
  applied: number;
  replayed: number;
  conflicts: number;
  rollbacks: number;
  recordedEvents: number;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`).join(',')}}`;
}

export function fingerprintPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

export function validateReconciliationEvent(event: ReconciliationEvent): void {
  if (event.eventId.trim() === '') throw new Error('eventId is required');
  if (event.aggregateId.trim() === '') throw new Error('aggregateId is required');
  if (event.type.trim() === '') throw new Error('event type is required');
  if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) throw new Error('occurredAt must be a valid date');
}

type Mutation<State> = (state: State | undefined, event: ReconciliationEvent) => State | Promise<State>;

/**
 * Immutable, idempotent event ledger. The in-memory implementation is used
 * by the service's local/test composition root; its contract mirrors the
 * unique-key + transaction boundary a Postgres adapter must implement.
 */
export class ReconciliationEventLedger<State> {
  private readonly events = new Map<string, EventLedgerRecord>();
  private readonly states = new Map<string, State>();
  private readonly audits: EventLedgerAudit[] = [];
  private appliedCount = 0;
  private replayedCount = 0;
  private conflictCount = 0;
  private rollbackCount = 0;
  private tail: Promise<void> = Promise.resolve();

  async process(event: ReconciliationEvent, mutate: Mutation<State>): Promise<EventProcessResult<State>> {
    validateReconciliationEvent(event);
    return this.serialized(async () => {
      const fingerprint = fingerprintPayload(event.payload);
      const existing = this.events.get(event.eventId);

      if (existing) {
        if (existing.payloadFingerprint !== fingerprint || existing.aggregateId !== event.aggregateId || existing.type !== event.type) {
          this.audits.push({ eventId: event.eventId, aggregateId: event.aggregateId, kind: 'conflict', detail: 'event identity was reused with a different payload or aggregate', createdAt: new Date() });
          this.conflictCount += 1;
          return { status: 'conflict', event: existing, state: this.requireState(event.aggregateId) };
        }
        this.replayedCount += 1;
        return { status: 'replayed', event: existing, state: this.requireState(event.aggregateId) };
      }

      const previous = this.states.get(event.aggregateId);
      try {
        const next = await mutate(previous, event);
        this.states.set(event.aggregateId, next);
      } catch (error) {
        this.audits.push({ eventId: event.eventId, aggregateId: event.aggregateId, kind: 'rollback', detail: error instanceof Error ? error.message : String(error), createdAt: new Date() });
        this.rollbackCount += 1;
        throw error;
      }

      const record: EventLedgerRecord = Object.freeze({
        eventId: event.eventId,
        aggregateId: event.aggregateId,
        type: event.type,
        payloadFingerprint: fingerprint,
        occurredAt: new Date(event.occurredAt),
        recordedAt: new Date(),
      });
      this.events.set(event.eventId, record);
      this.appliedCount += 1;
      return { status: 'applied', event: record, state: this.requireState(event.aggregateId) };
    });
  }

  seedState(aggregateId: string, state: State): void {
    this.states.set(aggregateId, state);
  }

  getEvent(eventId: string): EventLedgerRecord | null { return this.events.get(eventId) ?? null; }
  getState(aggregateId: string): State | null { return this.states.get(aggregateId) ?? null; }
  getAudits(): readonly EventLedgerAudit[] { return this.audits.slice(); }
  listEvents(): readonly EventLedgerRecord[] { return [...this.events.values()]; }

  report(): ReplayReport {
    return {
      applied: this.appliedCount,
      replayed: this.replayedCount,
      conflicts: this.conflictCount,
      rollbacks: this.rollbackCount,
      recordedEvents: this.events.size,
    };
  }

  private requireState(aggregateId: string): State {
    const state = this.states.get(aggregateId);
    if (state === undefined) throw new Error(`no state exists for aggregate ${aggregateId}`);
    return state;
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}
