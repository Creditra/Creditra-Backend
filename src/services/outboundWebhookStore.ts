import { randomUUID } from 'node:crypto';
import type { DbClient } from '../db/client.js';

export type OutboundWebhookStatus =
  | 'queued'
  | 'delivered'
  | 'failed'
  | 'dead_letter';

export interface OutboundWebhookSubscription {
  id: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  secretRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundWebhookDelivery {
  id: string;
  subscriptionId: string;
  url: string;
  eventType: string;
  eventId: string;
  status: OutboundWebhookStatus;
  payload: unknown;
  attempts: number;
  responseStatus?: number;
  lastError?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeliveryInput {
  subscriptionId: string;
  url: string;
  eventType: string;
  eventId: string;
  payload: unknown;
}

export interface DeliveryPatch {
  status?: OutboundWebhookStatus;
  attempts?: number;
  responseStatus?: number;
  lastError?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
}

export interface DeliveryFilter {
  status?: OutboundWebhookStatus;
  limit?: number;
}

export interface OutboundWebhookStore {
  upsertEnvSubscription(params: {
    url: string;
    eventTypes: string[];
    secretRef: string;
  }): Promise<OutboundWebhookSubscription>;
  listSubscriptions(): Promise<OutboundWebhookSubscription[]>;
  createDelivery(input: CreateDeliveryInput): Promise<OutboundWebhookDelivery>;
  getDelivery(id: string): Promise<OutboundWebhookDelivery | null>;
  findDelivery(
    subscriptionId: string,
    eventId: string,
  ): Promise<OutboundWebhookDelivery | null>;
  updateDelivery(
    id: string,
    patch: DeliveryPatch,
  ): Promise<OutboundWebhookDelivery>;
  listDeliveries(filter?: DeliveryFilter): Promise<OutboundWebhookDelivery[]>;
}

const nowIso = (): string => new Date().toISOString();

export class InMemoryOutboundWebhookStore implements OutboundWebhookStore {
  private readonly subscriptions = new Map<string, OutboundWebhookSubscription>();
  private readonly deliveries = new Map<string, OutboundWebhookDelivery>();

  async upsertEnvSubscription(params: {
    url: string;
    eventTypes: string[];
    secretRef: string;
  }): Promise<OutboundWebhookSubscription> {
    const existing = [...this.subscriptions.values()].find(
      (subscription) => subscription.url === params.url,
    );
    const timestamp = nowIso();
    const subscription: OutboundWebhookSubscription = {
      id: existing?.id ?? randomUUID(),
      url: params.url,
      eventTypes: [...params.eventTypes],
      active: true,
      secretRef: params.secretRef,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  async listSubscriptions(): Promise<OutboundWebhookSubscription[]> {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.active)
      .map((subscription) => ({ ...subscription }));
  }

  async createDelivery(
    input: CreateDeliveryInput,
  ): Promise<OutboundWebhookDelivery> {
    const timestamp = nowIso();
    const delivery: OutboundWebhookDelivery = {
      id: randomUUID(),
      ...input,
      status: 'queued',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.deliveries.set(delivery.id, delivery);
    return { ...delivery };
  }

  async getDelivery(id: string): Promise<OutboundWebhookDelivery | null> {
    const delivery = this.deliveries.get(id);
    return delivery ? { ...delivery } : null;
  }

  async findDelivery(
    subscriptionId: string,
    eventId: string,
  ): Promise<OutboundWebhookDelivery | null> {
    const delivery = [...this.deliveries.values()].find(
      (entry) =>
        entry.subscriptionId === subscriptionId && entry.eventId === eventId,
    );
    return delivery ? { ...delivery } : null;
  }

  async updateDelivery(
    id: string,
    patch: DeliveryPatch,
  ): Promise<OutboundWebhookDelivery> {
    const existing = this.deliveries.get(id);
    if (!existing) {
      throw new Error(`Webhook delivery not found: ${id}`);
    }
    const updated = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    this.deliveries.set(id, updated);
    return { ...updated };
  }

  async listDeliveries(
    filter: DeliveryFilter = {},
  ): Promise<OutboundWebhookDelivery[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return [...this.deliveries.values()]
      .filter((delivery) => !filter.status || delivery.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((delivery) => ({ ...delivery }));
  }
}

export class PostgresOutboundWebhookStore implements OutboundWebhookStore {
  constructor(private readonly db: DbClient) {}

  async upsertEnvSubscription(params: {
    url: string;
    eventTypes: string[];
    secretRef: string;
  }): Promise<OutboundWebhookSubscription> {
    const result = await this.db.query(
      `INSERT INTO outbound_webhook_subscriptions
        (url, event_types, active, secret_ref, created_at, updated_at)
       VALUES ($1, $2::jsonb, true, $3, now(), now())
       ON CONFLICT (url) DO UPDATE SET
         event_types = EXCLUDED.event_types,
         active = true,
         secret_ref = EXCLUDED.secret_ref,
         updated_at = now()
       RETURNING id, url, event_types, active, secret_ref, created_at, updated_at`,
      [params.url, JSON.stringify(params.eventTypes), params.secretRef],
    );
    return mapSubscription(result.rows[0] as Record<string, unknown>);
  }

  async listSubscriptions(): Promise<OutboundWebhookSubscription[]> {
    const result = await this.db.query(
      `SELECT id, url, event_types, active, secret_ref, created_at, updated_at
       FROM outbound_webhook_subscriptions
       WHERE active = true
       ORDER BY created_at ASC`,
    );
    return result.rows.map((row) =>
      mapSubscription(row as Record<string, unknown>),
    );
  }

  async createDelivery(
    input: CreateDeliveryInput,
  ): Promise<OutboundWebhookDelivery> {
    const result = await this.db.query(
      `INSERT INTO outbound_webhook_deliveries
        (subscription_id, url, event_type, event_id, payload, status, attempts,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', 0, now(), now())
       RETURNING *`,
      [
        input.subscriptionId,
        input.url,
        input.eventType,
        input.eventId,
        JSON.stringify(input.payload),
      ],
    );
    return mapDelivery(result.rows[0] as Record<string, unknown>);
  }

  async getDelivery(id: string): Promise<OutboundWebhookDelivery | null> {
    const result = await this.db.query(
      `SELECT * FROM outbound_webhook_deliveries WHERE id = $1`,
      [id],
    );
    return result.rows[0]
      ? mapDelivery(result.rows[0] as Record<string, unknown>)
      : null;
  }

  async findDelivery(
    subscriptionId: string,
    eventId: string,
  ): Promise<OutboundWebhookDelivery | null> {
    const result = await this.db.query(
      `SELECT * FROM outbound_webhook_deliveries
       WHERE subscription_id = $1 AND event_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [subscriptionId, eventId],
    );
    return result.rows[0]
      ? mapDelivery(result.rows[0] as Record<string, unknown>)
      : null;
  }

  async updateDelivery(
    id: string,
    patch: DeliveryPatch,
  ): Promise<OutboundWebhookDelivery> {
    const current = await this.getDelivery(id);
    if (!current) {
      throw new Error(`Webhook delivery not found: ${id}`);
    }
    const next = {
      status: patch.status ?? current.status,
      attempts: patch.attempts ?? current.attempts,
      responseStatus: patch.responseStatus ?? current.responseStatus ?? null,
      lastError: patch.lastError ?? current.lastError ?? null,
      nextAttemptAt: patch.nextAttemptAt ?? current.nextAttemptAt ?? null,
      deliveredAt: patch.deliveredAt ?? current.deliveredAt ?? null,
    };
    const result = await this.db.query(
      `UPDATE outbound_webhook_deliveries
       SET status = $2,
           attempts = $3,
           response_status = $4,
           last_error = $5,
           next_attempt_at = $6,
           delivered_at = $7,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        next.status,
        next.attempts,
        next.responseStatus,
        next.lastError,
        next.nextAttemptAt,
        next.deliveredAt,
      ],
    );
    return mapDelivery(result.rows[0] as Record<string, unknown>);
  }

  async listDeliveries(
    filter: DeliveryFilter = {},
  ): Promise<OutboundWebhookDelivery[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const params: unknown[] = [limit];
    let where = '';
    if (filter.status) {
      params.push(filter.status);
      where = 'WHERE status = $2';
    }
    const result = await this.db.query(
      `SELECT * FROM outbound_webhook_deliveries
       ${where}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    );
    return result.rows.map((row) =>
      mapDelivery(row as Record<string, unknown>),
    );
  }
}

function mapSubscription(row: Record<string, unknown>): OutboundWebhookSubscription {
  return {
    id: String(row.id),
    url: String(row.url),
    eventTypes: Array.isArray(row.event_types)
      ? (row.event_types as string[])
      : JSON.parse(String(row.event_types ?? '[]')),
    active: Boolean(row.active),
    secretRef: String(row.secret_ref),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapDelivery(row: Record<string, unknown>): OutboundWebhookDelivery {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    url: String(row.url),
    eventType: String(row.event_type),
    eventId: String(row.event_id),
    status: row.status as OutboundWebhookStatus,
    payload:
      typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : (row.payload ?? {}),
    attempts: Number(row.attempts ?? 0),
    responseStatus:
      row.response_status == null ? undefined : Number(row.response_status),
    lastError: row.last_error == null ? undefined : String(row.last_error),
    nextAttemptAt: row.next_attempt_at == null ? undefined : toIso(row.next_attempt_at),
    deliveredAt: row.delivered_at == null ? undefined : toIso(row.delivered_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
