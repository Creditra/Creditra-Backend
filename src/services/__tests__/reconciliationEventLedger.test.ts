import { describe, expect, it, vi } from 'vitest';
import {
  fingerprintPayload,
  ReconciliationEventLedger,
  validateReconciliationEvent,
  type EventLedgerAudit,
  type EventLedgerRecord,
  type ReconciliationEvent,
} from '../reconciliationEventLedger.js';
import { ReconciliationService } from '../reconciliationService.js';

const baseEvent = (overrides: Partial<ReconciliationEvent> = {}): ReconciliationEvent => ({
  eventId: 'provider-event-1',
  aggregateId: 'credit-line-1',
  type: 'repayment.confirmed',
  payload: { amount: '10.00', provider: 'soroban', nested: { z: 1, a: true } },
  occurredAt: new Date('2026-08-24T00:00:00Z'),
  ...overrides,
});

describe('ReconciliationEventLedger', () => {
  it('fingerprints equivalent object payloads independent of key order', () => {
    expect(fingerprintPayload({ a: 1, b: { z: 2, a: 3 } })).toBe(fingerprintPayload({ b: { a: 3, z: 2 }, a: 1 }));
  });

  it('validates identity, aggregate, type, and occurrence time', () => {
    expect(() => validateReconciliationEvent(baseEvent({ eventId: ' ' }))).toThrow('eventId');
    expect(() => validateReconciliationEvent(baseEvent({ aggregateId: '' }))).toThrow('aggregateId');
    expect(() => validateReconciliationEvent(baseEvent({ type: '' }))).toThrow('event type');
    expect(() => validateReconciliationEvent(baseEvent({ occurredAt: new Date('invalid') }))).toThrow('occurredAt');
  });

  it('applies a first event and records an immutable event', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent();
    const result = await ledger.process(event, (current) => ({ balance: (current?.balance ?? 0) + 10 }));
    expect(result.status).toBe('applied');
    expect(result.state).toEqual({ balance: 10 });
    expect(Object.isFrozen(result.event)).toBe(true);
    expect(ledger.getEvent(event.eventId)?.payloadFingerprint).toBe(fingerprintPayload(event.payload));
  });

  it('makes exact replay a no-op and returns the original state', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const mutate = vi.fn((current: { balance: number } | undefined) => ({ balance: (current?.balance ?? 0) + 10 }));
    const event = baseEvent();
    await ledger.process(event, mutate);
    const replay = await ledger.process({ ...event, payload: { nested: { a: true, z: 1 }, provider: 'soroban', amount: '10.00' } }, mutate);
    expect(replay.status).toBe('replayed');
    expect(replay.state).toEqual({ balance: 10 });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('rejects identity reuse with changed payload and records an audit', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent();
    await ledger.process(event, () => ({ balance: 10 }));
    const conflict = await ledger.process({ ...event, payload: { amount: '99.00' } }, () => ({ balance: 99 }));
    expect(conflict.status).toBe('conflict');
    expect(conflict.state).toEqual({ balance: 10 });
    expect(ledger.getAudits()).toEqual([expect.objectContaining({ kind: 'conflict', eventId: event.eventId })]);
  });

  it('rejects identity reuse across aggregates or event types', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent();
    await ledger.process(event, () => ({ balance: 10 }));
    ledger.seedState('credit-line-2', { balance: 20 });
    const conflict = await ledger.process({ ...event, aggregateId: 'credit-line-2' }, () => ({ balance: 30 }));
    expect(conflict.status).toBe('conflict');
    expect(ledger.getEvent(event.eventId)?.aggregateId).toBe('credit-line-1');
  });

  it('rolls back state and leaves no event record if mutation fails', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    ledger.seedState('credit-line-1', { balance: 7 });
    await expect(ledger.process(baseEvent(), () => { throw new Error('database unavailable'); })).rejects.toThrow('database unavailable');
    expect(ledger.getEvent('provider-event-1')).toBeNull();
    expect(ledger.getAudits()[0]).toEqual(expect.objectContaining({ kind: 'rollback' }));
  });

  it('serializes concurrent duplicate processing so only one mutates', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    let mutations = 0;
    const mutate = async (current: { balance: number } | undefined) => {
      mutations += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { balance: (current?.balance ?? 0) + 10 };
    };
    const [first, second] = await Promise.all([ledger.process(baseEvent(), mutate), ledger.process(baseEvent(), mutate)]);
    expect([first.status, second.status].sort()).toEqual(['applied', 'replayed']);
    expect(mutations).toBe(1);
    expect(ledger.listEvents()).toHaveLength(1);
  });

  it('serializes distinct aggregate events and preserves both mutations', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const eventTwo = baseEvent({ eventId: 'provider-event-2', payload: { amount: '5.00' } });
    const [first, second] = await Promise.all([
      ledger.process(baseEvent(), (current) => ({ balance: (current?.balance ?? 0) + 10 })),
      ledger.process(eventTwo, (current) => ({ balance: (current?.balance ?? 0) + 5 })),
    ]);
    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied');
    expect(second.state).toEqual({ balance: 15 });
    expect(ledger.listEvents()).toHaveLength(2);
  });

  it('reports recorded events, conflicts, and rollbacks for operators', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent();
    await ledger.process(event, () => ({ balance: 10 }));
    await ledger.process({ ...event, payload: { amount: '11.00' } }, () => ({ balance: 11 }));
    await expect(ledger.process(baseEvent({ eventId: 'provider-event-3' }), () => { throw new Error('rollback'); })).rejects.toThrow();
    expect(ledger.report()).toEqual({ applied: 1, replayed: 0, conflicts: 1, rollbacks: 1, recordedEvents: 1 });
  });

  it('counts exact replays separately from applied events', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent();
    await ledger.process(event, () => ({ balance: 10 }));
    await ledger.process(event, () => ({ balance: 20 }));
    await ledger.process(event, () => ({ balance: 30 }));
    expect(ledger.report()).toMatchObject({ applied: 1, replayed: 2, conflicts: 0, rollbacks: 0, recordedEvents: 1 });
  });

  it('applies a sequence of distinct provider events to one aggregate', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number; history: string[] }>();
    const first = baseEvent({ eventId: 'event-a', payload: { amount: '10' } });
    const second = baseEvent({ eventId: 'event-b', type: 'interest.accrued', payload: { amount: '2' } });
    await ledger.process(first, (current, event) => ({ balance: (current?.balance ?? 0) + Number(event.payload.amount), history: [...(current?.history ?? []), event.eventId] }));
    const result = await ledger.process(second, (current, event) => ({ balance: (current?.balance ?? 0) + Number(event.payload.amount), history: [...(current?.history ?? []), event.eventId] }));
    expect(result.state).toEqual({ balance: 12, history: ['event-a', 'event-b'] });
    expect(ledger.listEvents().map((record) => record.eventId)).toEqual(['event-a', 'event-b']);
  });

  it('passes the event to the mutation callback for domain validation', async () => {
    const ledger = new ReconciliationEventLedger<{ type: string }>();
    const apply = vi.fn((_current: { type: string } | undefined, event: ReconciliationEvent) => ({ type: event.type }));
    await ledger.process(baseEvent({ type: 'draw.confirmed' }), apply);
    expect(apply).toHaveBeenCalledWith(undefined, expect.objectContaining({ type: 'draw.confirmed' }));
  });

  it('copies occurrence timestamps so caller mutation cannot alter the record', async () => {
    const ledger = new ReconciliationEventLedger<{ ok: boolean }>();
    const event = baseEvent();
    const originalTime = event.occurredAt.getTime();
    const result = await ledger.process(event, () => ({ ok: true }));
    event.occurredAt.setTime(0);
    expect(result.event?.occurredAt.getTime()).toBe(originalTime);
  });

  it('keeps state unchanged after a failed second event', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    await ledger.process(baseEvent({ eventId: 'event-a' }), () => ({ balance: 10 }));
    await expect(ledger.process(baseEvent({ eventId: 'event-b' }), () => Promise.reject(new Error('constraint violation')))).rejects.toThrow('constraint violation');
    expect(ledger.getState('credit-line-1')).toEqual({ balance: 10 });
    expect(ledger.getEvent('event-b')).toBeNull();
    expect(ledger.listEvents()).toHaveLength(1);
  });

  it('records a conflict for changed event type even with the same payload', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent();
    await ledger.process(event, () => ({ balance: 10 }));
    const result = await ledger.process({ ...event, type: 'draw.confirmed' }, () => ({ balance: 99 }));
    expect(result.status).toBe('conflict');
    expect(ledger.report().conflicts).toBe(1);
  });

  it('does not expose mutable internal audit or event arrays', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    await ledger.process(baseEvent(), () => ({ balance: 10 }));
    const events = ledger.listEvents() as EventLedgerRecord[];
    events.pop();
    const audits = ledger.getAudits() as EventLedgerAudit[];
    audits.push({ eventId: 'fake', aggregateId: 'fake', kind: 'conflict', detail: 'fake', createdAt: new Date() });
    expect(ledger.listEvents()).toHaveLength(1);
    expect(ledger.getAudits()).toHaveLength(0);
  });
});

describe('ReconciliationService event integration', () => {
  function makeService(): ReconciliationService {
    return new ReconciliationService(
      {} as never,
      { fetchAllCreditRecords: vi.fn().mockResolvedValue([]) },
      { enqueue: vi.fn(), registerHandler: vi.fn(), start: vi.fn(), stop: vi.fn(), isRunning: vi.fn(), size: vi.fn(), getFailedJobs: vi.fn(), drain: vi.fn() },
    );
  }

  it('exposes the ledger through the reconciliation service boundary', async () => {
    const service = makeService();
    const event = baseEvent({ eventId: 'service-event-1' });
    const first = await service.processEvent(event, (_current, incoming) => ({
      id: incoming.aggregateId,
      walletAddress: 'GTEST',
      creditLimit: '100',
      availableCredit: '90',
      interestRateBps: 500,
      status: 'active',
    }));
    expect(first.status).toBe('applied');
    expect(first.state.id).toBe('credit-line-1');
    expect(service.getEventLedgerReport()).toMatchObject({ applied: 1, recordedEvents: 1 });
  });

  it('replays through the service without invoking the domain mutation twice', async () => {
    const service = makeService();
    const event = baseEvent({ eventId: 'service-event-2' });
    const apply = vi.fn(() => ({ id: 'credit-line-1', walletAddress: 'GTEST', creditLimit: '100', availableCredit: '90', interestRateBps: 500, status: 'active' }));
    await service.processEvent(event, apply);
    const replay = await service.processEvent(event, apply);
    expect(replay.status).toBe('replayed');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(service.getEventLedgerReport()).toMatchObject({ applied: 1, replayed: 1 });
  });

  it('returns a conflict result to callers instead of silently changing state', async () => {
    const service = makeService();
    const event = baseEvent({ eventId: 'service-event-3' });
    const state = { id: 'credit-line-1', walletAddress: 'GTEST', creditLimit: '100', availableCredit: '90', interestRateBps: 500, status: 'active' };
    await service.processEvent(event, () => state);
    const conflict = await service.processEvent({ ...event, payload: { amount: '999' } }, () => ({ ...state, availableCredit: '0' }));
    expect(conflict.status).toBe('conflict');
    expect(conflict.state.availableCredit).toBe('90');
  });

  it('does not record a service event when the domain mutation rejects', async () => {
    const service = makeService();
    await expect(service.processEvent(baseEvent({ eventId: 'service-event-4' }), async () => {
      await Promise.resolve();
      throw new Error('transaction rolled back');
    })).rejects.toThrow('transaction rolled back');
    expect(service.getEventLedgerReport()).toMatchObject({ applied: 0, recordedEvents: 0, rollbacks: 1 });
  });

  it('keeps event identity scoped to the provider event id', async () => {
    const service = makeService();
    const state = { id: 'credit-line-1', walletAddress: 'GTEST', creditLimit: '100', availableCredit: '100', interestRateBps: 500, status: 'active' };
    await service.processEvent(baseEvent({ eventId: 'service-event-a' }), () => state);
    const second = await service.processEvent(baseEvent({ eventId: 'service-event-b', payload: { amount: '5' } }), () => ({ ...state, availableCredit: '95' }));
    expect(second.status).toBe('applied');
    expect(service.getEventLedgerReport().recordedEvents).toBe(2);
  });

  it('preserves a zero balance as a valid aggregate state', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    ledger.seedState('credit-line-1', { balance: 0 });
    const result = await ledger.process(baseEvent({ eventId: 'zero-state' }), (current) => ({ balance: (current?.balance ?? 0) + 1 }));
    expect(result.state.balance).toBe(1);
    expect(ledger.getState('credit-line-1')?.balance).toBe(1);
  });

  it('does not allow an unseeded conflicting aggregate to be fabricated', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    await ledger.process(baseEvent(), () => ({ balance: 10 }));
    await expect(ledger.process({ ...baseEvent(), aggregateId: 'missing-aggregate' }, () => ({ balance: 50 }))).rejects.toThrow('no state exists');
    expect(ledger.listEvents()).toHaveLength(1);
  });

  it('retains conflict and rollback audits in chronological insertion order', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    await ledger.process(baseEvent(), () => ({ balance: 10 }));
    await ledger.process({ ...baseEvent(), payload: { amount: '11' } }, () => ({ balance: 11 }));
    await expect(ledger.process(baseEvent({ eventId: 'later' }), () => { throw new Error('later rollback'); })).rejects.toThrow();
    expect(ledger.getAudits().map((audit) => audit.kind)).toEqual(['conflict', 'rollback']);
  });

  it('keeps a duplicate record immutable after another event is applied', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const first = await ledger.process(baseEvent({ eventId: 'immutable-a' }), () => ({ balance: 10 }));
    const recordedAt = first.event?.recordedAt.getTime();
    await ledger.process(baseEvent({ eventId: 'immutable-b', payload: { amount: '2' } }), (current) => ({ balance: (current?.balance ?? 0) + 2 }));
    const replay = await ledger.process(baseEvent({ eventId: 'immutable-a' }), () => ({ balance: 999 }));
    expect(replay.status).toBe('replayed');
    expect(replay.event?.recordedAt.getTime()).toBe(recordedAt);
    expect(replay.state.balance).toBe(12);
  });

  it('supports provider payloads containing nested arrays without unstable hashes', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    const event = baseEvent({
      eventId: 'nested-payload',
      payload: { entries: [{ id: 'a', amount: '3' }, { id: 'b', amount: '4' }], metadata: { source: 'provider' } },
    });
    const apply = vi.fn(() => ({ balance: 7 }));
    await ledger.process(event, apply);
    const replay = await ledger.process({
      ...event,
      payload: { metadata: { source: 'provider' }, entries: [{ id: 'a', amount: '3' }, { id: 'b', amount: '4' }] },
    }, apply);
    expect(replay.status).toBe('replayed');
    expect(apply).toHaveBeenCalledOnce();
  });

  it('keeps a failed event available for a later successful retry', async () => {
    const ledger = new ReconciliationEventLedger<{ balance: number }>();
    let shouldFail = true;
    const apply = () => {
      if (shouldFail) throw new Error('temporary storage error');
      return { balance: 25 };
    };
    await expect(ledger.process(baseEvent({ eventId: 'retryable' }), apply)).rejects.toThrow('temporary storage error');
    shouldFail = false;
    const retried = await ledger.process(baseEvent({ eventId: 'retryable' }), apply);
    expect(retried.status).toBe('applied');
    expect(ledger.report()).toMatchObject({ applied: 1, rollbacks: 1, recordedEvents: 1 });
  });
});
