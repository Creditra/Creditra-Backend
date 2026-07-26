export interface InboundWebhookNonceStore {
  claim(nonce: string, expiresAtMs: number): boolean;
  purgeExpired(nowMs?: number): number;
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

export const defaultInboundWebhookNonceStore = new InMemoryInboundWebhookNonceStore();
