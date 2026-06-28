/**
 * Durable-ish delivery-state tracking for outbound draw webhooks.
 *
 * The README promises every confirmed event is "delivered exactly once", but
 * the fan-out in `drawWebhookService.ts` is otherwise fire-and-forget: a
 * process restart mid-retry drops the event, and a re-emitted Horizon event
 * re-delivers it. This store records delivery state keyed by `(drawId, url)`
 * so that:
 *
 * - Already-delivered `(drawId, url)` pairs short-circuit before re-POSTing,
 *   honoring the subscriber-side dedup contract on `data.drawId`.
 * - Deliveries that exhaust `WEBHOOK_MAX_RETRIES` land in a dead-letter list
 *   instead of being silently dropped (mirroring `jobQueue.ts`).
 * - Delivery and dead-letter counts are queryable for the webhook health
 *   endpoint.
 *
 * The default implementation is an in-memory store behind an interface so a
 * Postgres-backed repository can be substituted later without touching the
 * sender. Writes are synchronous and cheap so they never block the fan-out
 * `Promise.all`.
 */

export type DeliveryStatus = "delivered" | "failed" | "dead_letter";

export interface DeliveryRecord {
    drawId: string;
    url: string;
    status: DeliveryStatus;
    attempts: number;
    lastError?: string;
    deliveredAt?: string;
    updatedAt: string;
}

export interface WebhookDeliveryStateStore {
    /** True if `(drawId, url)` already succeeded and must not be re-POSTed. */
    isDelivered(drawId: string, url: string): boolean;
    /** Persist the outcome of a delivery attempt. */
    record(record: Omit<DeliveryRecord, "updatedAt">): void;
    /** Read-only snapshot of permanently failed (dead-letter) deliveries. */
    deadLetters(): DeliveryRecord[];
    /** Counts by status plus the total tracked deliveries. */
    counts(): {
        total: number;
        delivered: number;
        failed: number;
        deadLetter: number;
    };
}

function key(drawId: string, url: string): string {
    return `${drawId}::${url}`;
}

class InMemoryWebhookDeliveryStateStore implements WebhookDeliveryStateStore {
    private readonly records = new Map<string, DeliveryRecord>();

    isDelivered(drawId: string, url: string): boolean {
        return this.records.get(key(drawId, url))?.status === "delivered";
    }

    record(record: Omit<DeliveryRecord, "updatedAt">): void {
        this.records.set(key(record.drawId, record.url), {
            ...record,
            updatedAt: new Date().toISOString(),
        });
    }

    deadLetters(): DeliveryRecord[] {
        return [...this.records.values()].filter(
            (r) => r.status === "dead_letter"
        );
    }

    counts(): {
        total: number;
        delivered: number;
        failed: number;
        deadLetter: number;
    } {
        let delivered = 0;
        let failed = 0;
        let deadLetter = 0;
        for (const r of this.records.values()) {
            if (r.status === "delivered") delivered++;
            else if (r.status === "failed") failed++;
            else if (r.status === "dead_letter") deadLetter++;
        }
        return { total: this.records.size, delivered, failed, deadLetter };
    }
}

let activeStore: WebhookDeliveryStateStore = new InMemoryWebhookDeliveryStateStore();

export function getWebhookDeliveryStateStore(): WebhookDeliveryStateStore {
    return activeStore;
}

/** Override the store (e.g. a Postgres-backed implementation, or in tests). */
export function setWebhookDeliveryStateStore(
    store: WebhookDeliveryStateStore
): void {
    activeStore = store;
}
