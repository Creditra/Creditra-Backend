import { describe, it, expect } from 'vitest';
import { ApiKeyStore } from '../apiKeyStore.js';

describe('ApiKeyStore', () => {
  it('issues a key that verifies, returning plaintext once and storing only a hash', () => {
    const store = new ApiKeyStore();
    const { id, plaintext, metadata } = store.issue('ci');

    expect(plaintext).toMatch(/^ck_/);
    expect(metadata.status).toBe('active');
    expect(store.verify(plaintext)).toBe(true);
    // Metadata never leaks the secret.
    expect(JSON.stringify(store.list())).not.toContain(plaintext);
    expect(id).toBeTruthy();
  });

  it('supports multiple active keys at once (rotation overlap)', () => {
    const store = new ApiKeyStore();
    const a = store.issue('old');
    const b = store.issue('new');

    expect(store.verify(a.plaintext)).toBe(true);
    expect(store.verify(b.plaintext)).toBe(true);
    expect(store.list().filter((k) => k.status === 'active')).toHaveLength(2);
  });

  it('keeps a revoked key valid during the grace period, then rejects it', () => {
    let now = 1_000_000;
    const grace = 60_000;
    const store = new ApiKeyStore(grace, () => now);
    const { id, plaintext } = store.issue('rotating');

    expect(store.revoke(id)).toBe(true);
    // Within grace window → still valid.
    now += grace - 1;
    expect(store.verify(plaintext)).toBe(true);
    // Past grace window → rejected.
    now += 2;
    expect(store.verify(plaintext)).toBe(false);
  });

  it('rejects an unknown key', () => {
    const store = new ApiKeyStore();
    store.issue('x');
    expect(store.verify('ck_does_not_exist')).toBe(false);
    expect(store.verify('')).toBe(false);
  });

  it('revoke is idempotent and 404-able for unknown ids', () => {
    const store = new ApiKeyStore();
    const { id } = store.issue('x');
    expect(store.revoke(id)).toBe(true);
    expect(store.revoke(id)).toBe(true);
    expect(store.revoke('nope')).toBe(false);
  });

  it('writes audit entries without secret material', () => {
    const store = new ApiKeyStore();
    const { id, plaintext } = store.issue('audited');
    store.revoke(id);

    const log = store.auditLog();
    expect(log.map((e) => e.action)).toEqual(['issued', 'revoked']);
    expect(JSON.stringify(log)).not.toContain(plaintext);
  });
});
