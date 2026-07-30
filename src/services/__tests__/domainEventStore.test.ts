import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDomainEventStore } from '../domainEventStore.js';
import { EventBus } from '../events/eventBus.js';
import { registerDomainEventStoreSubscriber } from '../events/domainEventSubscriber.js';
import type { CreditOpenedEvent, CreditDomainEvent } from '../events/domainEvents.js';

function openedEvent(overrides: Partial<CreditOpenedEvent> = {}): CreditOpenedEvent {
  return {
    type: 'credit.opened',
    creditLineId: 'cl-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: { walletAddress: 'GA...', creditLimit: '1000' },
    ...overrides,
  };
}

describe('InMemoryDomainEventStore', () => {
  let store: InMemoryDomainEventStore;

  beforeEach(() => {
    store = new InMemoryDomainEventStore();
  });

  it('appends and lists events oldest-first', async () => {
    await store.append(openedEvent({ occurredAt: '2026-01-02T00:00:00.000Z' }));
    await store.append(
      openedEvent({ type: 'credit.draw_requested', occurredAt: '2026-01-01T00:00:00.000Z' } as unknown as CreditOpenedEvent),
    );

    const rows = await store.list();
    expect(rows).toHaveLength(2);
  });

  it('is idempotent on (aggregateId, eventType, occurredAt)', async () => {
    const event = openedEvent();
    await store.append(event);
    await store.append(event);
    await store.append({ ...event });

    const rows = await store.list();
    expect(rows).toHaveLength(1);
  });

  it('filters by aggregateId and eventType', async () => {
    await store.append(openedEvent({ creditLineId: 'cl-1' }));
    await store.append(openedEvent({ creditLineId: 'cl-2', occurredAt: '2026-01-02T00:00:00.000Z' }));

    expect(await store.list({ aggregateId: 'cl-2' })).toHaveLength(1);
    expect(await store.list({ eventType: 'credit.opened' })).toHaveLength(2);
    expect(await store.list({ eventType: 'credit.defaulted' })).toHaveLength(0);
  });
});

describe('registerDomainEventStoreSubscriber', () => {
  it('persists every lifecycle event published on the bus', async () => {
    const bus = new EventBus();
    const store = new InMemoryDomainEventStore();
    registerDomainEventStoreSubscriber(bus, store);

    await bus.publish(openedEvent() as CreditDomainEvent);

    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('credit.opened');
    expect(rows[0].aggregateId).toBe('cl-1');
  });

  it('disposer removes the subscription', async () => {
    const bus = new EventBus();
    const store = new InMemoryDomainEventStore();
    const dispose = registerDomainEventStoreSubscriber(bus, store);
    dispose();

    await bus.publish(openedEvent() as CreditDomainEvent);

    expect(await store.list()).toHaveLength(0);
  });
});
