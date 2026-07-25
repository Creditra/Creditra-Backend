/**
 * Nonce cache for inbound webhook replay protection.
 *
 * Nonces are claimed once after signature + timestamp checks succeed and
 * expire after the configured TTL (aligned with the timestamp tolerance
 * window). The default store is in-process for single-node / tests.
 * Durable deployments can back the same interface with Postgres using
 * migration `006_inbound_webhook_nonces.sql`.
 */

export interface InboundWebhookNonceStore {
  /**
   * Atomically claim `nonce` until `expiresAtMs`.
   * @returns `true` if this is the first claim; `false` if already seen.
   */
  claim(nonce: string, expiresAtMs: number): boolean;

  /** Drop expired entries. Returns how many were removed. */
  purgeExpired(nowMs?: number): number;

  /** Test helper — clear all nonces. */
  resetForTests(): void;
}

export class InMemoryInboundWebhookNonceStore implements InboundWebhookNonceStore {
  private readonly nonces = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  claim(nonce: string, expiresAtMs: number): boolean {
    this.purgeExpired();
    if (this.nonces.has(nonce)) {
      return false;
    }
    this.nonces.set(nonce, expiresAtMs);
    return true;
  }

  purgeExpired(nowMs: number = this.now()): number {
    let purged = 0;
    for (const [nonce, expiresAtMs] of this.nonces.entries()) {
      if (expiresAtMs <= nowMs) {
        this.nonces.delete(nonce);
        purged += 1;
      }
    }
    return purged;
  }

  resetForTests(): void {
    this.nonces.clear();
  }
}

/** Shared default store used by the production middleware factory. */
export const defaultInboundWebhookNonceStore = new InMemoryInboundWebhookNonceStore();
