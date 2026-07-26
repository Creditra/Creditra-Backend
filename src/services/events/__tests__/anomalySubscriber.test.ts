import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../eventBus.js';
import { registerAnomalySubscriber } from '../anomalySubscriber.js';
import { AnomalyDetectionService } from '../../anomalyDetectionService.js';
import { InMemoryRiskSignalRepository } from '../../../repositories/memory/InMemoryRiskSignalRepository.js';
import { DEFAULT_ANOMALY_DETECTION_CONFIG } from '../../../config/anomalyDetection.js';
import { nowIso } from '../domainEvents.js';

const WALLET = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';
const LINE_ID = '22222222-2222-2222-2222-222222222222';

describe('registerAnomalySubscriber', () => {
  let bus: EventBus;
  let service: AnomalyDetectionService;
  let repo: InMemoryRiskSignalRepository;

  beforeEach(() => {
    bus = new EventBus();
    repo = new InMemoryRiskSignalRepository();
    service = new AnomalyDetectionService(repo, {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG,
      signalCooldownSeconds: 1,
      rapidSuccessiveDraws: { minCount: 3, windowSeconds: 300 },
      drawBurst: { minCount: 99, windowSeconds: 1 },
      unusualRepayPattern: {
        minCycles: 2,
        pairWindowSeconds: 120,
        patternWindowSeconds: 600,
        amountToleranceRatio: 0.1,
      },
    });
  });

  it('records signals when draw_confirmed events form a rapid pattern', async () => {
    const sink = vi.fn();
    registerAnomalySubscriber(bus, service, sink);

    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      await bus.publish({
        type: 'credit.draw_confirmed',
        occurredAt: new Date(base + i * 1_000).toISOString(),
        creditLineId: LINE_ID,
        payload: { walletAddress: WALLET, amount: '25', utilized: String(25 * (i + 1)) },
      });
    }

    const listed = await service.listSignals({ creditLineId: LINE_ID });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(sink).toHaveBeenCalled();
    const lastCall = sink.mock.calls[sink.mock.calls.length - 1][0];
    expect(lastCall.signalCount).toBeGreaterThanOrEqual(1);
    expect(lastCall.correlationId).toBeTruthy();
  });

  it('ignores non-draw/repay lifecycle events', async () => {
    const sink = vi.fn();
    registerAnomalySubscriber(bus, service, sink);

    await bus.publish({
      type: 'credit.opened',
      occurredAt: nowIso(),
      creditLineId: LINE_ID,
      payload: { walletAddress: WALLET, creditLimit: '1000' },
    });

    expect(sink).not.toHaveBeenCalled();
    const listed = await service.listSignals();
    expect(listed.total).toBe(0);
  });

  it('disposer removes subscriptions', async () => {
    const dispose = registerAnomalySubscriber(bus, service);
    dispose();

    await bus.publish({
      type: 'credit.draw_confirmed',
      occurredAt: nowIso(),
      creditLineId: LINE_ID,
      payload: { walletAddress: WALLET, amount: '10', utilized: '10' },
    });

    const listed = await service.listSignals();
    expect(listed.total).toBe(0);
  });
});
