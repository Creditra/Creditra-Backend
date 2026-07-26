/**
 * Anomaly-detection subscriber for credit lifecycle events.
 *
 * Hooks into draw/repay confirmations on the {@link EventBus} and feeds them
 * into {@link AnomalyDetectionService}. Subscriber failures are isolated so
 * the core credit path never fails because of risk-signal recording.
 */
import type { EventBus } from './eventBus.js';
import type {
  CreditDomainEvent,
  DrawConfirmedEvent,
  RepayConfirmedEvent,
} from './domainEvents.js';
import type { AnomalyDetectionService } from '../anomalyDetectionService.js';

const WATCHED = ['credit.draw_confirmed', 'credit.repay_confirmed'] as const;

export type AnomalySignalSink = (info: {
  eventType: string;
  creditLineId: string;
  signalCount: number;
  correlationId: string;
}) => void;

function defaultSink(info: {
  eventType: string;
  creditLineId: string;
  signalCount: number;
  correlationId: string;
}): void {
  if (info.signalCount > 0) {
    console.log(
      '[anomaly]',
      JSON.stringify({
        ...info,
        message: 'risk signals recorded',
      }),
    );
  }
}

/**
 * Subscribe anomaly detection to draw/repay lifecycle events.
 * Returns a disposer that removes all subscriptions.
 */
export function registerAnomalySubscriber(
  bus: EventBus,
  service: AnomalyDetectionService,
  sink: AnomalySignalSink = defaultSink,
): () => void {
  const handler = async (event: CreditDomainEvent): Promise<void> => {
    if (
      event.type !== 'credit.draw_confirmed' &&
      event.type !== 'credit.repay_confirmed'
    ) {
      return;
    }

    const kind = event.type === 'credit.draw_confirmed' ? 'draw' : 'repay';
    const payload = (event as DrawConfirmedEvent | RepayConfirmedEvent).payload;
    const occurredAtMs = Date.parse(event.occurredAt);
    const result = await service.observe({
      kind,
      creditLineId: event.creditLineId,
      walletAddress: payload.walletAddress,
      amount: payload.amount,
      occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
    });

    sink({
      eventType: event.type,
      creditLineId: event.creditLineId,
      signalCount: result.signals.length,
      correlationId: result.correlationId,
    });
  };

  const disposers = WATCHED.map((type) => bus.subscribe(type, handler));
  return () => disposers.forEach((dispose) => dispose());
}
