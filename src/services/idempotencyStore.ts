import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/client.js";

export interface CachedIdempotencyResponse {
  statusCode: number;
  body: unknown;
}

export type IdempotencyBeginResult =
  | { state: "started"; token: string }
  | { state: "replay"; response: CachedIdempotencyResponse }
  | { state: "pending"; response: Promise<CachedIdempotencyResponse> }
  | { state: "inProgress" }
  | { state: "conflict" };

export interface IdempotencyEntry {
  keyHash: string;
  scope: string;
  principalHash: string;
  requestHash: string;
}

export interface IdempotencyStore {
  begin(entry: IdempotencyEntry): Promise<IdempotencyBeginResult>;
  complete(token: string, response: CachedIdempotencyResponse): Promise<void>;
  fail(token: string): Promise<void>;
}

interface PendingMemoryRecord {
  state: "pending";
  token: string;
  requestHash: string;
  expiresAt: number;
  promise: Promise<CachedIdempotencyResponse>;
  resolve: (response: CachedIdempotencyResponse) => void;
  reject: (error: Error) => void;
}

interface CompletedMemoryRecord {
  state: "completed";
  token: string;
  requestHash: string;
  expiresAt: number;
  response: CachedIdempotencyResponse;
}

type MemoryRecord = PendingMemoryRecord | CompletedMemoryRecord;

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly tokens = new Map<string, string>();

  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {}

  async begin(entry: IdempotencyEntry): Promise<IdempotencyBeginResult> {
    this.pruneExpired();
    const cacheKey = this.cacheKey(entry);
    const existing = this.records.get(cacheKey);

    if (existing) {
      if (existing.requestHash !== entry.requestHash) {
        return { state: "conflict" };
      }

      if (existing.state === "completed") {
        return { state: "replay", response: existing.response };
      }

      return { state: "pending", response: existing.promise };
    }

    const token = randomUUID();
    let resolve!: (response: CachedIdempotencyResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<CachedIdempotencyResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.records.set(cacheKey, {
      state: "pending",
      token,
      requestHash: entry.requestHash,
      expiresAt: Date.now() + this.ttlMs,
      promise,
      resolve,
      reject,
    });
    this.tokens.set(token, cacheKey);

    return { state: "started", token };
  }

  async complete(token: string, response: CachedIdempotencyResponse): Promise<void> {
    const cacheKey = this.tokens.get(token);
    if (!cacheKey) return;

    const record = this.records.get(cacheKey);
    if (!record || record.state !== "pending") return;

    this.records.set(cacheKey, {
      state: "completed",
      token,
      requestHash: record.requestHash,
      expiresAt: Date.now() + this.ttlMs,
      response,
    });
    record.resolve(response);
  }

  async fail(token: string): Promise<void> {
    const cacheKey = this.tokens.get(token);
    if (!cacheKey) return;

    const record = this.records.get(cacheKey);
    this.records.delete(cacheKey);
    this.tokens.delete(token);

    if (record?.state === "pending") {
      record.reject(new Error("Idempotent request did not complete"));
    }
  }

  private cacheKey(entry: IdempotencyEntry): string {
    return `${entry.keyHash}:${entry.scope}:${entry.principalHash}`;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [cacheKey, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(cacheKey);
        this.tokens.delete(record.token);
      }
    }
  }
}

interface IdempotencyRow {
  token: string;
  request_hash: string;
  status: "pending" | "completed";
  response_status: number | null;
  response_body: unknown | null;
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  private connected?: Promise<void>;

  constructor(
    private readonly client: DbClient,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
  ) {}

  async begin(entry: IdempotencyEntry): Promise<IdempotencyBeginResult> {
    await this.ensureConnected();
    await this.deleteExpired();

    const expiresAt = new Date(Date.now() + this.ttlMs);
    const token = randomUUID();

    const inserted = await this.client.query(
      `
        INSERT INTO idempotency_keys (
          token,
          key_hash,
          scope,
          principal_hash,
          request_hash,
          status,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        ON CONFLICT (key_hash, scope, principal_hash) DO NOTHING
        RETURNING token
      `,
      [token, entry.keyHash, entry.scope, entry.principalHash, entry.requestHash, expiresAt],
    );

    if (inserted.rows.length > 0) {
      return { state: "started", token };
    }

    const existing = await this.client.query(
      `
        SELECT token, request_hash, status, response_status, response_body
        FROM idempotency_keys
        WHERE key_hash = $1 AND scope = $2 AND principal_hash = $3
      `,
      [entry.keyHash, entry.scope, entry.principalHash],
    );
    const row = existing.rows[0] as IdempotencyRow | undefined;

    if (!row) {
      return this.begin(entry);
    }

    if (row.request_hash !== entry.requestHash) {
      return { state: "conflict" };
    }

    if (row.status === "completed" && row.response_status !== null) {
      return {
        state: "replay",
        response: {
          statusCode: row.response_status,
          body: row.response_body,
        },
      };
    }

    return { state: "inProgress" };
  }

  async complete(token: string, response: CachedIdempotencyResponse): Promise<void> {
    await this.ensureConnected();
    await this.client.query(
      `
        UPDATE idempotency_keys
        SET status = 'completed',
            response_status = $2,
            response_body = $3::jsonb,
            updated_at = now()
        WHERE token = $1
      `,
      [token, response.statusCode, JSON.stringify(response.body ?? null)],
    );
  }

  async fail(token: string): Promise<void> {
    await this.ensureConnected();
    await this.client.query(
      "DELETE FROM idempotency_keys WHERE token = $1 AND status = 'pending'",
      [token],
    );
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client.connect) return;
    if (!this.connected) {
      this.connected = this.client.connect();
    }
    await this.connected;
  }

  private async deleteExpired(): Promise<void> {
    await this.client.query("DELETE FROM idempotency_keys WHERE expires_at <= now()");
  }
}
