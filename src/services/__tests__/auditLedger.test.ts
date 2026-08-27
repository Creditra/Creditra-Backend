import { describe, expect, it } from 'vitest';
import {
  AuditLedger,
  redactAuditState,
} from '../auditLedger.js';
import type { AuditLedgerError } from '../auditLedger.js';

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    actor: 'borrower-a',
    action: 'draw',
    entityType: 'credit_line',
    entityId: 'line-1',
    before: { utilized: 0 },
    after: { utilized: 100 },
    metadata: { source: 'api' },
    at: 1_000,
    ...overrides,
  };
}

describe('audit state redaction', () => {
  it('redacts credential-shaped keys at every nesting level', () => {
    expect(redactAuditState({
      password: 'pw',
      profile: { apiKey: 'key', nested: [{ token: 'token' }] },
      safe: 'value',
    })).toEqual({
      password: '[REDACTED]',
      profile: { apiKey: '[REDACTED]', nested: [{ token: '[REDACTED]' }] },
      safe: 'value',
    });
  });

  it('redacts bearer and Stellar secret-key values even under neutral keys', () => {
    expect(redactAuditState({
      header: 'Bearer very-sensitive-token',
      credentialValue: 'S' + 'A'.repeat(55),
      number: 42,
    })).toEqual({
      header: '[REDACTED]',
      credentialValue: '[REDACTED]',
      number: 42,
    });
  });

  it('converts unsupported values to safe representations', () => {
    expect(redactAuditState({ amount: 1n, functionValue: () => 'secret' })).toEqual({
      amount: '1',
      functionValue: '[REDACTED]',
    });
  });
});

describe('append-only audit ledger', () => {
  it('creates a hash-linked record and verifies the chain', () => {
    const ledger = new AuditLedger({ maxAgeMs: 10_000, maxRecords: 10 });
    const first = ledger.append(input());
    const second = ledger.append(input({ entityId: 'line-2', at: 1_001 }));
    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.hash);
    expect(ledger.verify()).toEqual({ valid: true, checked: 2, issues: [] });
  });

  it('returns defensive copies and never persists raw credentials', () => {
    const ledger = new AuditLedger();
    const created = ledger.append(input({
      metadata: { authorization: 'Bearer raw-token', api_secret: 'raw-secret' },
    }));
    created.after = { utilized: 999_999 };
    expect(ledger.list()[0]?.after).toEqual({ utilized: 100 });
    expect(JSON.stringify(ledger.list())).not.toContain('raw-token');
    expect(JSON.stringify(ledger.list())).not.toContain('raw-secret');
  });

  it('does not expose records from another tenant', () => {
    const ledger = new AuditLedger();
    ledger.append(input({ tenantId: 'tenant-a', entityId: 'a-1' }));
    ledger.append(input({ tenantId: 'tenant-b', entityId: 'b-1' }));
    expect(ledger.list('tenant-a').map((record) => record.entityId)).toEqual(['a-1']);
    expect(ledger.list('tenant-b').map((record) => record.entityId)).toEqual(['b-1']);
  });

  it('records financial actions under a stable namespace', () => {
    const ledger = new AuditLedger();
    const record = ledger.recordFinancialMutation(input({ action: 'repay' }));
    expect(record.action).toBe('financial.repay');
  });

  it('rejects incomplete audit identity fields with a stable code', () => {
    const ledger = new AuditLedger();
    expect(() => ledger.append(input({ tenantId: '' }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' } satisfies Partial<AuditLedgerError>),
    );
  });
});

describe('audit integrity and retention', () => {
  it('detects tampering after records are rehydrated from persistence', () => {
    const ledger = new AuditLedger();
    ledger.append(input());
    const persisted = ledger.list();
    persisted[0]!.after = { utilized: 777 };
    const restored = AuditLedger.fromRecords(persisted);
    const report = restored.verify();
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });

  it('detects a broken link between otherwise valid records', () => {
    const ledger = new AuditLedger();
    ledger.append(input({ entityId: 'line-1' }));
    ledger.append(input({ entityId: 'line-2', at: 1_001 }));
    const persisted = ledger.list();
    persisted[1]!.previousHash = null;
    const restored = AuditLedger.fromRecords(persisted);
    expect(restored.verify().issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
    expect(restored.verify().issues).toContainEqual(expect.objectContaining({ code: 'CHAIN_BREAK' }));
  });

  it('retains only records inside both age and count policy limits', () => {
    const ledger = new AuditLedger({ maxAgeMs: 100, maxRecords: 2 });
    ledger.append(input({ entityId: 'old', at: 800 }));
    ledger.append(input({ entityId: 'mid', at: 950 }));
    ledger.append(input({ entityId: 'new', at: 990 }));
    expect(ledger.retain(1_000)).toEqual({ removed: 1, remaining: 2 });
    expect(ledger.list().map((record) => record.entityId)).toEqual(['mid', 'new']);
  });

  it('does not allow an invalid retention policy', () => {
    expect(() => new AuditLedger({ maxAgeMs: -1, maxRecords: 10 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RETENTION_POLICY' } satisfies Partial<AuditLedgerError>),
    );
  });

  it('is safe to verify repeatedly without changing the ledger', () => {
    const ledger = new AuditLedger();
    ledger.append(input());
    const first = ledger.verify();
    const second = ledger.verify();
    expect(second).toEqual(first);
    expect(ledger.size).toBe(1);
  });
});
