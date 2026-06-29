/**
 * Domain event definitions for the credit lifecycle.
 *
 * These are the canonical, in-process events emitted by the service layer when
 * credit-line state changes. Downstream concerns (audit log, webhook dispatch,
 * notifications) subscribe to them via the {@link EventBus} so they stay
 * decoupled from the core request path.
 *
 * See `docs/ARCHITECTURE.md` §3 (eventing) for delivery semantics.
 */

/** Discriminator for every credit-lifecycle event. */
export type CreditEventType =
  | 'credit.opened'
  | 'credit.draw_requested'
  | 'credit.draw_confirmed'
  | 'credit.repay_confirmed'
  | 'credit.defaulted';

/** Fields common to every domain event. */
export interface DomainEventEnvelope<T extends CreditEventType, P> {
  /** Stable event-type discriminator. */
  readonly type: T;
  /** ISO-8601 timestamp at which the event was emitted. */
  readonly occurredAt: string;
  /** Credit line the event pertains to. */
  readonly creditLineId: string;
  /** Event-specific payload. */
  readonly payload: P;
}

export type CreditOpenedEvent = DomainEventEnvelope<
  'credit.opened',
  { walletAddress: string; creditLimit: string }
>;

export type DrawRequestedEvent = DomainEventEnvelope<
  'credit.draw_requested',
  { walletAddress: string; amount: string }
>;

export type DrawConfirmedEvent = DomainEventEnvelope<
  'credit.draw_confirmed',
  { walletAddress: string; amount: string; utilized: string }
>;

export type RepayConfirmedEvent = DomainEventEnvelope<
  'credit.repay_confirmed',
  { walletAddress: string; amount: string; utilized: string }
>;

export type DefaultedEvent = DomainEventEnvelope<
  'credit.defaulted',
  { walletAddress: string; reason?: string }
>;

/** Union of all credit lifecycle events. */
export type CreditDomainEvent =
  | CreditOpenedEvent
  | DrawRequestedEvent
  | DrawConfirmedEvent
  | RepayConfirmedEvent
  | DefaultedEvent;

/** Helper to stamp `occurredAt` on a freshly minted event. */
export function nowIso(): string {
  return new Date().toISOString();
}
