import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../eventBus.js';
import { registerAuditSubscriber, type AuditRecord } from '../auditSubscriber.js';
import { nowIso, type CreditDomainEvent } from '../domainEvents.js';
import { CreditLineService } from '../../CreditLineService.js';
import { InMemoryCreditLineRepository } from '../../../repositories/memory/InMemoryCreditLineRepository.js';

function openedEvent(creditLineId = 'cl-1'): CreditDomainEvent {
  return {
    type: 'credit.opened',
    occurredAt: nowIso(),
    creditLineId,
    payload: { walletAddress: 'GWALLET', creditLimit: '1000.00' },
  };
}

describe('EventBus', () => {
  it('invokes every subscriber for an event type', async () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('credit.opened', a);
    bus.subscribe('credit.opened', b);

    await bus.publish(openedEvent());

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not invoke handlers for other event types', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('credit.repay_confirmed', handler);

    await bus.publish(openedEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates a failing handler so peers still run (at-least-once)', async () => {
    const errors: unknown[] = [];
    const bus = new EventBus((err) => errors.push(err));
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const surviving = vi.fn();
    bus.subscribe('credit.opened', failing);
    bus.subscribe('credit.opened', surviving);

    await bus.publish(openedEvent());

    expect(surviving).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
  });

  it('unsubscribe removes the handler', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.subscribe('credit.opened', handler);
    off();

    await bus.publish(openedEvent());

    expect(handler).not.toHaveBeenCalled();
    expect(bus.handlerCount('credit.opened')).toBe(0);
  });
});

describe('audit subscriber', () => {
  it('records an audit entry for every lifecycle event', async () => {
    const bus = new EventBus();
    const records: AuditRecord[] = [];
    registerAuditSubscriber(bus, (r) => {
      records.push(r);
    });

    await bus.publish(openedEvent('cl-9'));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: 'credit.opened', creditLineId: 'cl-9' });
    expect(records[0].details).toMatchObject({ walletAddress: 'GWALLET' });
  });
});

describe('CreditLineService event emission', () => {
  it('emits opened, draw_requested, draw_confirmed and repay_confirmed', async () => {
    const bus = new EventBus();
    const seen: CreditDomainEvent['type'][] = [];
    (['credit.opened', 'credit.draw_requested', 'credit.draw_confirmed', 'credit.repay_confirmed'] as const).forEach(
      (t) => bus.subscribe(t, (e) => void seen.push(e.type)),
    );

    const service = new CreditLineService(new InMemoryCreditLineRepository(), bus);
    const line = await service.createCreditLine({
      walletAddress: 'GWALLET',
      creditLimit: '1000.00',
      interestRateBps: 500,
    });
    await service.draw(line.id, 'GWALLET', '100.00');
    await service.repay(line.id, 'GWALLET', '50.00');

    // Allow fire-and-forget publishes to settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(seen).toEqual(
      expect.arrayContaining([
        'credit.opened',
        'credit.draw_requested',
        'credit.draw_confirmed',
        'credit.repay_confirmed',
      ]),
    );
  });

  it('works without an event bus (backward compatible)', async () => {
    const service = new CreditLineService(new InMemoryCreditLineRepository());
    const line = await service.createCreditLine({
      walletAddress: 'GWALLET',
      creditLimit: '1000.00',
      interestRateBps: 500,
    });
    expect(line.id).toBeDefined();
  });
});
