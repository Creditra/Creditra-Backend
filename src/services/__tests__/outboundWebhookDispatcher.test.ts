import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../events/eventBus.js';
import { InMemoryJobQueue } from '../jobQueue.js';
import { OutboundWebhookDispatcher } from '../outboundWebhookDispatcher.js';
import { InMemoryOutboundWebhookStore } from '../outboundWebhookStore.js';

describe('OutboundWebhookDispatcher', () => {
  it('queues and delivers credit lifecycle events asynchronously', async () => {
    const store = new InMemoryOutboundWebhookStore();
    const queue = new InMemoryJobQueue();
    const bus = new EventBus();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
    });

    const dispatcher = new OutboundWebhookDispatcher(
      store,
      queue,
      bus,
      {
        secret: 'test-secret',
        maxAttempts: 3,
        timeoutMs: 1_000,
        initialBackoffMs: 10,
      },
      fetchImpl as unknown as typeof fetch,
    );
    await dispatcher.initializeFromEnvironment(['https://example.com/hook']);

    await bus.publish({
      type: 'credit.opened',
      occurredAt: '2026-07-09T00:00:00.000Z',
      creditLineId: 'credit-1',
      payload: { walletAddress: 'GABC', creditLimit: '1000' },
    });

    expect(queue.size()).toBe(1);
    await queue.drain();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Webhook-Signature': expect.stringMatching(/^sha256=/),
          'User-Agent': 'Creditra-Webhook/1.0',
        }),
        body: expect.stringContaining('"event":"credit.opened"'),
      }),
    );

    const deliveries = await dispatcher.listDeliveries();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      eventType: 'credit.opened',
      status: 'delivered',
      attempts: 1,
      responseStatus: 204,
    });
  });

  it('moves exhausted deliveries to dead-letter state', async () => {
    const store = new InMemoryOutboundWebhookStore();
    const queue = new InMemoryJobQueue();
    const bus = new EventBus();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
    });

    const dispatcher = new OutboundWebhookDispatcher(
      store,
      queue,
      bus,
      {
        secret: 'test-secret',
        maxAttempts: 1,
        timeoutMs: 1_000,
        initialBackoffMs: 10,
      },
      fetchImpl as unknown as typeof fetch,
    );
    await dispatcher.initializeFromEnvironment(['https://example.com/hook']);

    const jobIds = await dispatcher.scheduleEvent({
      type: 'credit.repay_confirmed',
      occurredAt: '2026-07-09T00:00:00.000Z',
      creditLineId: 'credit-1',
      payload: { walletAddress: 'GABC', amount: '10', utilized: '90' },
    });

    expect(jobIds).toHaveLength(1);
    await queue.drain();

    const deliveries = await dispatcher.listDeliveries({ status: 'dead_letter' });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      eventType: 'credit.repay_confirmed',
      status: 'dead_letter',
      attempts: 1,
    });
    expect(queue.getFailedJobs()).toHaveLength(1);
  });
});
