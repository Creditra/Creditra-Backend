import { describe, it, expect } from 'vitest';
import { AdminAuditLog, actorFingerprint, redactAuditValue } from '../adminAuditLog.js';

describe('AdminAuditLog', () => {
  it('redacts sensitive fields recursively before storing records', () => {
    const log = new AdminAuditLog(() => new Date('2026-07-09T00:00:00.000Z'));

    const record = log.record({
      actor: actorFingerprint('admin-secret'),
      action: 'api_key.issued',
      target: { type: 'api_key', id: 'key-1' },
      after: {
        id: 'key-1',
        plaintextKey: 'ck_secret',
        nested: { authorization: 'Bearer secret' },
      },
    });

    expect(record.after).toEqual({
      id: 'key-1',
      plaintextKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
    expect(JSON.stringify(record)).not.toContain('ck_secret');
    expect(JSON.stringify(record)).not.toContain('Bearer secret');
  });

  it('creates a tamper-evident hash chain', () => {
    const log = new AdminAuditLog(() => new Date('2026-07-09T00:00:00.000Z'));

    const first = log.record({
      actor: 'actor-1',
      action: 'maintenance_mode.updated',
      target: { type: 'maintenance_mode' },
      after: { enabled: true },
      correlationId: 'corr-1',
    });
    const second = log.record({
      actor: 'actor-1',
      action: 'maintenance_mode.updated',
      target: { type: 'maintenance_mode' },
      after: { enabled: false },
      correlationId: 'corr-2',
    });

    expect(first.previousHash).toBeNull();
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it('filters and paginates newest-first records', () => {
    let tick = 0;
    const log = new AdminAuditLog(() => new Date(1000 + tick++));

    log.record({ actor: 'a', action: 'one', target: { type: 'credit_line', id: '1' } });
    log.record({ actor: 'b', action: 'two', target: { type: 'api_key', id: '2' } });
    log.record({ actor: 'a', action: 'three', target: { type: 'credit_line', id: '3' } });

    const firstPage = log.list({ targetType: 'credit_line', limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0].action).toBe('three');
    expect(firstPage.hasMore).toBe(true);

    const secondPage = log.list({ targetType: 'credit_line', limit: 1, cursor: firstPage.nextCursor ?? undefined });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].action).toBe('one');
    expect(secondPage.hasMore).toBe(false);
  });

  it('exposes redaction as a standalone helper', () => {
    expect(redactAuditValue({ token: 'secret', keep: 'value' })).toEqual({
      token: '[REDACTED]',
      keep: 'value',
    });
  });
});
