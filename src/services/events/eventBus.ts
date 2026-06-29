/**
 * In-process domain event bus.
 *
 * A minimal publish/subscribe bus used to decouple downstream handlers
 * (audit log, webhooks, notifications) from the core credit-line request path.
 *
 * Delivery semantics (documented limitations):
 *  - **In-process only.** Events are not persisted; they are lost on process
 *    crash before a handler runs. For durable, cross-process delivery use an
 *    external broker. This bus is intentionally lightweight.
 *  - **At-least-once within the process.** Every registered handler for an
 *    event type is invoked. A throwing or rejecting handler does not prevent
 *    the others from running, and the failure is reported to an optional
 *    error sink so a supervisor can retry/alert.
 *  - **Synchronous publish, awaited handlers.** `publish` resolves only after
 *    all handlers settle, giving callers a back-pressure point when needed.
 */
import type { CreditDomainEvent, CreditEventType } from './domainEvents.js';

/** A handler may be sync or async; its rejection is isolated from peers. */
export type EventHandler<E extends CreditDomainEvent = CreditDomainEvent> = (
  event: E,
) => void | Promise<void>;

/** Optional sink invoked when a handler throws/rejects. */
export type EventErrorSink = (error: unknown, event: CreditDomainEvent, handlerName: string) => void;

export class EventBus {
  private readonly handlers = new Map<CreditEventType, Set<EventHandler>>();

  constructor(private readonly onError: EventErrorSink = defaultErrorSink) {}

  /**
   * Register `handler` for `type`. Returns an unsubscribe function so callers
   * (e.g. tests) can deterministically tear down their subscription.
   */
  subscribe<E extends CreditDomainEvent>(
    type: E['type'],
    handler: EventHandler<E>,
  ): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler as EventHandler);
    };
  }

  /**
   * Publish `event` to every subscriber of its type. Resolves once all
   * handlers settle. A failing handler is isolated: the error is routed to the
   * error sink and the remaining handlers still run (at-least-once delivery).
   */
  async publish(event: CreditDomainEvent): Promise<void> {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) {
      return;
    }
    // Snapshot so a handler that unsubscribes mid-dispatch is still invoked
    // exactly once for this event.
    const snapshot = Array.from(set);
    await Promise.all(
      snapshot.map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          this.onError(error, event, handler.name || 'anonymous');
        }
      }),
    );
  }

  /** Number of handlers registered for `type` — useful in tests. */
  handlerCount(type: CreditEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /** Remove every subscription. Intended for test isolation / shutdown. */
  clear(): void {
    this.handlers.clear();
  }
}

function defaultErrorSink(error: unknown, event: CreditDomainEvent, handlerName: string): void {
  // Never throw from the error sink itself.
  console.error(
    `[EventBus] handler "${handlerName}" failed for ${event.type} (creditLineId=${event.creditLineId}):`,
    error,
  );
}

/** Process-wide default bus, mirroring `defaultJobQueue`. */
export const defaultEventBus = new EventBus();
