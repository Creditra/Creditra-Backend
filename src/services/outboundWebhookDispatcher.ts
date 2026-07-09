import { createHmac } from 'node:crypto';
import type { CreditDomainEvent, CreditEventType } from './events/domainEvents.js';
import type { EventBus } from './events/eventBus.js';
import type { Job, JobQueue } from './jobQueue.js';
import type {
  OutboundWebhookDelivery,
  OutboundWebhookStore,
} from './outboundWebhookStore.js';
import { createServiceLogger } from '../utils/serviceLogger.js';

const log = createServiceLogger('OutboundWebhookDispatcher');

export const WEBHOOK_DELIVERY_JOB = 'outbound-webhook-delivery';

const DEFAULT_EVENT_TYPES: CreditEventType[] = [
  'credit.opened',
  'credit.draw_confirmed',
  'credit.repay_confirmed',
  'credit.defaulted',
];

export interface OutboundWebhookDispatcherConfig {
  secret: string;
  maxAttempts: number;
  timeoutMs: number;
  initialBackoffMs: number;
}

export class OutboundWebhookDispatcher {
  constructor(
    private readonly store: OutboundWebhookStore,
    private readonly jobQueue: JobQueue,
    private readonly eventBus: EventBus,
    private readonly config: OutboundWebhookDispatcherConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.jobQueue.registerHandler(
      WEBHOOK_DELIVERY_JOB,
      (job: Job<{ deliveryId: string }>) => this.processDeliveryJob(job),
    );
    this.subscribeToDomainEvents();
  }

  async initializeFromEnvironment(urls: string[]): Promise<void> {
    if (urls.length > 0 && !this.config.secret) {
      throw new Error('WEBHOOK_SECRET is required when WEBHOOK_URLS is configured');
    }
    await Promise.all(
      urls.map((url) =>
        this.store.upsertEnvSubscription({
          url,
          eventTypes: DEFAULT_EVENT_TYPES,
          secretRef: 'WEBHOOK_SECRET',
        }),
      ),
    );
  }

  async scheduleEvent(event: CreditDomainEvent): Promise<string[]> {
    const subscriptions = await this.store.listSubscriptions();
    const matching = subscriptions.filter(
      (subscription) =>
        subscription.active && subscription.eventTypes.includes(event.type),
    );

    const jobIds: string[] = [];
    for (const subscription of matching) {
      const eventId = this.eventId(event);
      const existing = await this.store.findDelivery(subscription.id, eventId);
      if (existing?.status === 'delivered') {
        continue;
      }

      const delivery = await this.store.createDelivery({
        subscriptionId: subscription.id,
        url: subscription.url,
        eventType: event.type,
        eventId,
        payload: this.payloadFor(event),
      });

      jobIds.push(
        this.jobQueue.enqueue(
          WEBHOOK_DELIVERY_JOB,
          { deliveryId: delivery.id },
          {
            maxAttempts: this.config.maxAttempts,
            id: `webhook-${delivery.id}`,
          },
        ),
      );
    }
    return jobIds;
  }

  async replayDelivery(deliveryId: string): Promise<string> {
    const delivery = await this.store.getDelivery(deliveryId);
    if (!delivery) {
      throw new Error(`Webhook delivery not found: ${deliveryId}`);
    }
    await this.store.updateDelivery(delivery.id, {
      status: 'queued',
      nextAttemptAt: undefined,
      lastError: undefined,
    });
    return this.jobQueue.enqueue(
      WEBHOOK_DELIVERY_JOB,
      { deliveryId },
      {
        maxAttempts: this.config.maxAttempts,
        id: `webhook-replay-${delivery.id}-${Date.now()}`,
      },
    );
  }

  async listDeliveries(filter?: Parameters<OutboundWebhookStore['listDeliveries']>[0]) {
    return this.store.listDeliveries(filter);
  }

  async listSubscriptions() {
    return this.store.listSubscriptions();
  }

  private subscribeToDomainEvents(): void {
    for (const type of DEFAULT_EVENT_TYPES) {
      this.eventBus.subscribe(type, (event) => {
        void this.scheduleEvent(event).catch((error) => {
          log.error('outbound-webhook:schedule:failed', {
            type: event.type,
            creditLineId: event.creditLineId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
    }
  }

  private async processDeliveryJob(
    job: Job<{ deliveryId: string }>,
  ): Promise<void> {
    const delivery = await this.store.getDelivery(job.payload.deliveryId);
    if (!delivery) {
      throw new Error(`Webhook delivery not found: ${job.payload.deliveryId}`);
    }
    const attempt = job.attempts + 1;

    try {
      const result = await this.deliver(delivery);
      await this.store.updateDelivery(delivery.id, {
        status: 'delivered',
        attempts: attempt,
        responseStatus: result.status,
        deliveredAt: new Date().toISOString(),
        lastError: undefined,
      });
      log.info('outbound-webhook:delivered', {
        deliveryId: delivery.id,
        eventType: delivery.eventType,
        attempt,
      });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      const finalAttempt = attempt >= deliveryMaxAttempts(job);
      await this.store.updateDelivery(delivery.id, {
        status: finalAttempt ? 'dead_letter' : 'failed',
        attempts: attempt,
        lastError,
        nextAttemptAt: finalAttempt
          ? undefined
          : new Date(Date.now() + this.config.initialBackoffMs).toISOString(),
      });
      log.error('outbound-webhook:delivery:failed', {
        deliveryId: delivery.id,
        eventType: delivery.eventType,
        attempt,
        finalAttempt,
        error: lastError,
      });
      throw error;
    }
  }

  private async deliver(
    delivery: OutboundWebhookDelivery,
  ): Promise<{ status: number }> {
    const body = JSON.stringify(delivery.payload);
    const signature = createHmac('sha256', this.config.secret)
      .update(body, 'utf8')
      .digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Timestamp': new Date().toISOString(),
          'User-Agent': 'Creditra-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return { status: response.status };
    } finally {
      clearTimeout(timeout);
    }
  }

  private payloadFor(event: CreditDomainEvent) {
    return {
      event: event.type,
      timestamp: new Date().toISOString(),
      data: {
        creditLineId: event.creditLineId,
        occurredAt: event.occurredAt,
        ...event.payload,
      },
    };
  }

  private eventId(event: CreditDomainEvent): string {
    return `${event.type}:${event.creditLineId}:${event.occurredAt}`;
  }
}

function deliveryMaxAttempts(job: Job): number {
  return Math.max(1, job.maxAttempts);
}
