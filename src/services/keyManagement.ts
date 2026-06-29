/**
 * Per-environment key management adapter.
 *
 * - local: reads keys from .env files / environment variables (dev/test)
 * - kms:   stub for AWS KMS / GCP KMS integration (staging/prod)
 *
 * Select via KEY_MANAGEMENT_ADAPTER env var: "local" (default) | "kms"
 */

export interface KeyManagementAdapter {
  getSecret(keyId: string): Promise<string>;
  setSecret(keyId: string, value: string): Promise<void>;
  rotateSecret(keyId: string): Promise<string>;
}

// ── Local file / env-var adapter (dev & test) ─────────────────────────────

class LocalKeyAdapter implements KeyManagementAdapter {
  private readonly store = new Map<string, string>();

  async getSecret(keyId: string): Promise<string> {
    // Check in-process store first, then environment variables.
    if (this.store.has(keyId)) return this.store.get(keyId)!;
    const envValue = process.env[keyId.toUpperCase().replace(/-/g, '_')];
    if (envValue !== undefined) return envValue;
    throw new Error(`LocalKeyAdapter: secret '${keyId}' not found`);
  }

  async setSecret(keyId: string, value: string): Promise<void> {
    this.store.set(keyId, value);
  }

  async rotateSecret(keyId: string): Promise<string> {
    const newValue = crypto.randomUUID();
    await this.setSecret(keyId, newValue);
    return newValue;
  }
}

// ── KMS stub adapter (staging / prod) ─────────────────────────────────────

class KmsKeyAdapter implements KeyManagementAdapter {
  constructor(private readonly kmsKeyArn: string) {}

  async getSecret(keyId: string): Promise<string> {
    // TODO: replace with actual AWS KMS / GCP KMS SDK call.
    // e.g. const result = await kmsClient.decrypt({ KeyId: this.kmsKeyArn, CiphertextBlob: … });
    throw new Error(`KmsKeyAdapter: not yet wired for key '${keyId}' (ARN: ${this.kmsKeyArn})`);
  }

  async setSecret(keyId: string, _value: string): Promise<void> {
    throw new Error(`KmsKeyAdapter: setSecret not implemented for key '${keyId}'`);
  }

  async rotateSecret(keyId: string): Promise<string> {
    // KMS supports key rotation natively; here we'd call the rotation API.
    throw new Error(`KmsKeyAdapter: rotateSecret not implemented for key '${keyId}'`);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

let _instance: KeyManagementAdapter | null = null;

export function getKeyManagementAdapter(): KeyManagementAdapter {
  if (_instance) return _instance;
  const adapterType = process.env['KEY_MANAGEMENT_ADAPTER'] ?? 'local';
  if (adapterType === 'kms') {
    const kmsArn = process.env['KMS_KEY_ARN'] ?? '';
    _instance = new KmsKeyAdapter(kmsArn);
  } else {
    _instance = new LocalKeyAdapter();
  }
  return _instance;
}

// Inject a custom adapter (useful in tests).
export function setKeyManagementAdapter(adapter: KeyManagementAdapter): void {
  _instance = adapter;
}
