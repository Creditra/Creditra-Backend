/**
 * Durable-replay subscriber for credit lifecycle events.
 *
 * Registers a handler on the {@link EventBus} that appends every credit lifecycle
 * event to a {@link DomainEventStore} (the `domain_events` table in production),
 * independent of the in-process audit/webhook subscribers. This is what makes the
 * event log replayable after a process crash — the bus itself is fire-and-forget.
 */
import type { EventBus } from './eventBus.js';
import type { CreditEventType } from './domainEvents.js';
import type { DomainEventStore } from '../domainEventStore.js';

const LIFECYCLE_EVENTS: readonly CreditEventType[] = [
  'credit.opened',
  'credit.draw_requested',
  'credit.draw_confirmed',
  'credit.repay_confirmed',
  'credit.defaulted',
];

/**
 * Subscribe `store.append` to every lifecycle event on `bus`.
 * Returns a disposer that removes all subscriptions.
 */
export function registerDomainEventStoreSubscriber(
  bus: EventBus,
  store: DomainEventStore,
): () => void {
  const disposers = LIFECYCLE_EVENTS.map((type) =>
    bus.subscribe(type, async (event) => {
      await store.append(event);
    }),
  );
  return () => disposers.forEach((dispose) => dispose());
}
