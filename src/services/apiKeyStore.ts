/**
 * API key store with rotation support.
 *
 * Enables zero-downtime key rotation by allowing **multiple active keys** at
 * once and a configurable **grace period** on revocation. Only SHA-256 hashes
 * of keys are stored — the plaintext key is returned exactly once, at creation
 * time, and never persisted.
 *
 * Lifecycle:
 *  - `issue()`     → mint a new key (returns plaintext once).
 *  - `revoke()`    → mark a key revoked; it remains valid until
 *                    `revokedAt + gracePeriodMs`, then is rejected.
 *  - `list()`      → metadata only (never hashes / plaintext).
 *  - `verify()`    → constant-time check that a presented key is currently
 *                    valid (active, or revoked-but-within-grace, not expired).
 *
 * Every lifecycle action appends an immutable audit entry (no secrets).
 *
 * This is an in-process reference implementation. A production deployment
 * would back `records` with the `api_keys` table; the public contract is the
 * same.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type ApiKeyStatus = 'active' | 'revoked';

/** Public metadata for an API key — never includes the hash or plaintext. */
export interface ApiKeyMetadata {
  readonly id: string;
  readonly label: string;
  readonly status: ApiKeyStatus;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  /** Absolute time after which a revoked key is hard-rejected. */
  readonly graceExpiresAt: string | null;
}

interface ApiKeyRecord extends ApiKeyMetadata {
  /** SHA-256 hex digest of the plaintext key. */
  readonly hash: string;
}

/** An immutable audit log entry. Never contains secret material. */
export interface ApiKeyAuditEntry {
  readonly action: 'issued' | 'revoked';
  readonly keyId: string;
  readonly label: string;
  readonly at: string;
}

const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export class ApiKeyStore {
  private readonly records = new Map<string, ApiKeyRecord>();
  private readonly audit: ApiKeyAuditEntry[] = [];

  constructor(
    private readonly gracePeriodMs: number = DEFAULT_GRACE_PERIOD_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Mint a new active key. Returns the plaintext **once** — it cannot be
   * recovered afterwards. Only the hash is retained.
   */
  issue(label: string): { id: string; plaintext: string; metadata: ApiKeyMetadata } {
    const id = randomBytes(8).toString('hex');
    const plaintext = `ck_${randomBytes(24).toString('hex')}`;
    const createdAt = new Date(this.now()).toISOString();
    const record: ApiKeyRecord = {
      id,
      label,
      status: 'active',
      createdAt,
      revokedAt: null,
      graceExpiresAt: null,
      hash: sha256Hex(plaintext),
    };
    this.records.set(id, record);
    this.audit.push({ action: 'issued', keyId: id, label, at: createdAt });
    return { id, plaintext, metadata: this.toMetadata(record) };
  }

  /**
   * Revoke a key. It stays valid until `now + gracePeriodMs` so in-flight
   * clients can rotate without downtime. Returns `false` if `id` is unknown.
   */
  revoke(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.status === 'revoked') return true;

    const revokedAt = this.now();
    const updated: ApiKeyRecord = {
      ...record,
      status: 'revoked',
      revokedAt: new Date(revokedAt).toISOString(),
      graceExpiresAt: new Date(revokedAt + this.gracePeriodMs).toISOString(),
    };
    this.records.set(id, updated);
    this.audit.push({
      action: 'revoked',
      keyId: id,
      label: record.label,
      at: updated.revokedAt as string,
    });
    return true;
  }

  /** Metadata for every key (active and revoked). No secrets. */
  list(): ApiKeyMetadata[] {
    return Array.from(this.records.values()).map((r) => this.toMetadata(r));
  }

  /**
   * Constant-time verification that `presented` maps to a currently valid key.
   * Valid = active, or revoked but still within the grace window.
   */
  verify(presented: string): boolean {
    if (!presented) return false;
    const presentedHash = sha256Hex(presented);
    const nowMs = this.now();
    let matched = false;
    // Iterate all records (no early return) to keep timing data-independent.
    for (const record of this.records.values()) {
      if (timingSafeHexEqual(record.hash, presentedHash) && this.isUsable(record, nowMs)) {
        matched = true;
      }
    }
    return matched;
  }

  /** Copy of the audit log (newest last). Never contains secret material. */
  auditLog(): ApiKeyAuditEntry[] {
    return [...this.audit];
  }

  private isUsable(record: ApiKeyRecord, nowMs: number): boolean {
    if (record.status === 'active') return true;
    if (record.graceExpiresAt === null) return false;
    return nowMs <= Date.parse(record.graceExpiresAt);
  }

  private toMetadata(record: ApiKeyRecord): ApiKeyMetadata {
    const { hash: _hash, ...metadata } = record;
    return metadata;
  }
}

/** Process-wide default store, seeded from `API_KEYS` for backward compat. */
export const defaultApiKeyStore = new ApiKeyStore();

/**
 * Seed the store from the comma-separated `API_KEYS` env var so existing
 * statically-configured keys keep working alongside rotation. Idempotent-ish:
 * call once at boot. Returns the number of keys seeded.
 */
export function seedFromEnv(store: ApiKeyStore = defaultApiKeyStore): number {
  const raw = process.env.API_KEYS ?? '';
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  for (const key of keys) {
    // Seeded keys are hashed directly (plaintext supplied by operator).
    store['records'].set(`env_${sha256Hex(key).slice(0, 12)}`, {
      id: `env_${sha256Hex(key).slice(0, 12)}`,
      label: 'env-seed',
      status: 'active',
      createdAt: new Date(Date.now()).toISOString(),
      revokedAt: null,
      graceExpiresAt: null,
      hash: sha256Hex(key),
    });
  }
  return keys.length;
}
