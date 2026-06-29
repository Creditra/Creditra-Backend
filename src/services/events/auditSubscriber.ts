/**
 * Audit-log subscriber for credit lifecycle events.
 *
 * Registers a handler on the {@link EventBus} that appends a structured,
 * append-only audit record for every credit lifecycle event. The default sink
 * writes to stdout via the shared logger contract; production deployments can
 * supply a sink that persists to the audit table instead.
 */
import type { EventBus } from './eventBus.js';
import type { CreditDomainEvent, CreditEventType } from './domainEvents.js';

const LIFECYCLE_EVENTS: readonly CreditEventType[] = [
  'credit.opened',
  'credit.draw_requested',
  'credit.draw_confirmed',
  'credit.repay_confirmed',
  'credit.defaulted',
];

/** A single immutable audit record derived from a domain event. */
export interface AuditRecord {
  readonly action: CreditEventType;
  readonly creditLineId: string;
  readonly occurredAt: string;
  readonly details: Record<string, unknown>;
}

/** Where audit records are written. Defaults to stdout. */
export type AuditSink = (record: AuditRecord) => void | Promise<void>;

function defaultAuditSink(record: AuditRecord): void {
  console.log('[audit]', JSON.stringify(record));
}

function toAuditRecord(event: CreditDomainEvent): AuditRecord {
  return {
    action: event.type,
    creditLineId: event.creditLineId,
    occurredAt: event.occurredAt,
    details: { ...event.payload },
  };
}

/**
 * Subscribe an audit handler to every lifecycle event on `bus`.
 * Returns a disposer that removes all subscriptions.
 */
export function registerAuditSubscriber(bus: EventBus, sink: AuditSink = defaultAuditSink): () => void {
  const disposers = LIFECYCLE_EVENTS.map((type) =>
    bus.subscribe(type, async (event) => {
      await sink(toAuditRecord(event));
    }),
  );
  return () => disposers.forEach((dispose) => dispose());
}
