import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogStore } from '../auditLogStore.js';
import type { AuditRecord } from '../events/auditSubscriber.js';

function record(partial: Partial<AuditRecord> & Pick<AuditRecord, 'action' | 'occurredAt'>): AuditRecord {
  return {
    creditLineId: partial.creditLineId ?? 'cl-1',
    details: partial.details ?? {},
    action: partial.action,
    occurredAt: partial.occurredAt,
  };
}

describe('AuditLogStore', () => {
  let store: AuditLogStore;

  beforeEach(() => {
    store = new AuditLogStore(3);
  });

  it('appends and queries newest-first', () => {
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-01T00:00:00.000Z' }));
    store.append(record({ action: 'credit.draw_requested', occurredAt: '2026-01-02T00:00:00.000Z' }));

    const rows = store.query();
    expect(rows).toHaveLength(2);
    expect(rows[0].action).toBe('credit.draw_requested');
  });

  it('drops oldest when over capacity', () => {
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-01T00:00:00.000Z', creditLineId: 'a' }));
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-02T00:00:00.000Z', creditLineId: 'b' }));
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-03T00:00:00.000Z', creditLineId: 'c' }));
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-04T00:00:00.000Z', creditLineId: 'd' }));

    expect(store.size()).toBe(3);
    expect(store.query().map((r) => r.creditLineId).sort()).toEqual(['b', 'c', 'd']);
  });

  it('filters by date range, action, and creditLineId', () => {
    store.append(
      record({
        action: 'credit.opened',
        occurredAt: '2026-01-01T12:00:00.000Z',
        creditLineId: 'cl-a',
      }),
    );
    store.append(
      record({
        action: 'credit.defaulted',
        occurredAt: '2026-01-15T12:00:00.000Z',
        creditLineId: 'cl-b',
      }),
    );
    store.append(
      record({
        action: 'credit.opened',
        occurredAt: '2026-02-01T12:00:00.000Z',
        creditLineId: 'cl-a',
      }),
    );

    const rows = store.query({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-31T23:59:59.999Z'),
      action: 'credit.opened',
      creditLineId: 'cl-a',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].occurredAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('paginates with offset and limit', () => {
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-01T00:00:00.000Z' }));
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-02T00:00:00.000Z' }));
    store.append(record({ action: 'credit.opened', occurredAt: '2026-01-03T00:00:00.000Z' }));

    const page = store.query({ offset: 1, limit: 1 });
    expect(page).toHaveLength(1);
    expect(page[0].occurredAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
