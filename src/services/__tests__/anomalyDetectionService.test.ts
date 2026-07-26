import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnomalyDetectionService,
  type ActivityEvent,
} from '../anomalyDetectionService.js';
import { InMemoryRiskSignalRepository } from '../../repositories/memory/InMemoryRiskSignalRepository.js';
import {
  DEFAULT_ANOMALY_DETECTION_CONFIG,
  type AnomalyDetectionConfig,
} from '../../config/anomalyDetection.js';
import { loadAnomalyDetectionConfig } from '../../config/anomalyDetection.js';

const WALLET = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';
const LINE_ID = '11111111-1111-1111-1111-111111111111';

function baseConfig(
  overrides: Partial<AnomalyDetectionConfig> = {},
): AnomalyDetectionConfig {
  return {
    ...DEFAULT_ANOMALY_DETECTION_CONFIG,
    signalCooldownSeconds: 1, // short cooldown for tests that expect multi-fire
    ...overrides,
    rapidSuccessiveDraws: {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG.rapidSuccessiveDraws,
      ...overrides.rapidSuccessiveDraws,
    },
    drawBurst: {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG.drawBurst,
      ...overrides.drawBurst,
    },
    unusualRepayPattern: {
      ...DEFAULT_ANOMALY_DETECTION_CONFIG.unusualRepayPattern,
      ...overrides.unusualRepayPattern,
    },
  };
}

function draw(
  atMs: number,
  amount = '100',
  extras: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    kind: 'draw',
    creditLineId: LINE_ID,
    walletAddress: WALLET,
    amount,
    occurredAtMs: atMs,
    ...extras,
  };
}

function repay(
  atMs: number,
  amount = '100',
  extras: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    kind: 'repay',
    creditLineId: LINE_ID,
    walletAddress: WALLET,
    amount,
    occurredAtMs: atMs,
    ...extras,
  };
}

describe('AnomalyDetectionService', () => {
  let repo: InMemoryRiskSignalRepository;
  let service: AnomalyDetectionService;

  beforeEach(() => {
    repo = new InMemoryRiskSignalRepository();
    service = new AnomalyDetectionService(repo, baseConfig());
  });

  describe('rapid_successive_draws', () => {
    it('does not fire below minCount', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 3, windowSeconds: 300 },
          drawBurst: { minCount: 99, windowSeconds: 1 },
        }),
      );
      const t0 = Date.now();
      await service.observe(draw(t0));
      const r = await service.observe(draw(t0 + 1_000));
      expect(r.signals.filter((s) => s.signalType === 'rapid_successive_draws')).toHaveLength(0);
    });

    it('fires when minCount draws land inside the window', async () => {
      const t0 = Date.now();
      await service.observe(draw(t0, '10'));
      await service.observe(draw(t0 + 30_000, '20'));
      const result = await service.observe(draw(t0 + 60_000, '30'));

      const rapid = result.signals.filter((s) => s.signalType === 'rapid_successive_draws');
      expect(rapid).toHaveLength(1);
      expect(rapid[0].severity).toBe('medium');
      expect(rapid[0].ruleId).toBe('rule.rapid_successive_draws');
      expect(rapid[0].correlationId).toBeTruthy();
      expect(rapid[0].thresholds.minCount).toBe(3);
      expect(rapid[0].evidence.drawCount).toBe(3);
      expect(rapid[0].walletAddress).toBe(WALLET);
      expect(rapid[0].creditLineId).toBe(LINE_ID);
    });

    it('does not fire when draws are spread beyond the window', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 3, windowSeconds: 60 },
          drawBurst: { minCount: 99, windowSeconds: 1 }, // disable burst for this case
        }),
      );
      const t0 = Date.now();
      await service.observe(draw(t0));
      await service.observe(draw(t0 + 61_000));
      const result = await service.observe(draw(t0 + 122_000));
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('draw_burst', () => {
    it('fires on high-frequency short-window draws', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 99, windowSeconds: 1 }, // isolate burst
          drawBurst: { minCount: 5, windowSeconds: 60 },
        }),
      );
      const t0 = Date.now();
      for (let i = 0; i < 4; i++) {
        await service.observe(draw(t0 + i * 5_000, String(10 + i)));
      }
      const result = await service.observe(draw(t0 + 20_000, '50'));
      const burst = result.signals.filter((s) => s.signalType === 'draw_burst');
      expect(burst).toHaveLength(1);
      expect(burst[0].severity).toBe('high');
      expect(burst[0].evidence.drawCount).toBe(5);
    });

    it('does not fire with only four draws in the burst window', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 99, windowSeconds: 1 },
          drawBurst: { minCount: 5, windowSeconds: 60 },
        }),
      );
      const t0 = Date.now();
      for (let i = 0; i < 3; i++) {
        await service.observe(draw(t0 + i * 5_000));
      }
      const result = await service.observe(draw(t0 + 15_000));
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('unusual_repay_pattern', () => {
    it('fires on repeated rapid draw→repay cycles of similar amount', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 99, windowSeconds: 1 },
          drawBurst: { minCount: 99, windowSeconds: 1 },
          unusualRepayPattern: {
            minCycles: 2,
            pairWindowSeconds: 120,
            patternWindowSeconds: 600,
            amountToleranceRatio: 0.1,
          },
        }),
      );
      const t0 = Date.now();
      await service.observe(draw(t0, '100'));
      await service.observe(repay(t0 + 10_000, '100'));
      await service.observe(draw(t0 + 20_000, '100'));
      const result = await service.observe(repay(t0 + 30_000, '100'));

      const pattern = result.signals.filter((s) => s.signalType === 'unusual_repay_pattern');
      expect(pattern).toHaveLength(1);
      expect(pattern[0].severity).toBe('high');
      expect(pattern[0].evidence.cycleCount).toBe(2);
      expect(pattern[0].thresholds.minCycles).toBe(2);
    });

    it('does not fire when repay amounts diverge beyond tolerance', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 99, windowSeconds: 1 },
          drawBurst: { minCount: 99, windowSeconds: 1 },
        }),
      );
      const t0 = Date.now();
      await service.observe(draw(t0, '100'));
      await service.observe(repay(t0 + 10_000, '50')); // 50% off
      await service.observe(draw(t0 + 20_000, '100'));
      const result = await service.observe(repay(t0 + 30_000, '50'));
      expect(result.signals).toHaveLength(0);
    });

    it('does not fire for a single draw→repay cycle', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          rapidSuccessiveDraws: { minCount: 99, windowSeconds: 1 },
          drawBurst: { minCount: 99, windowSeconds: 1 },
        }),
      );
      const t0 = Date.now();
      await service.observe(draw(t0, '100'));
      const result = await service.observe(repay(t0 + 10_000, '100'));
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('cooldown and disabled mode', () => {
    it('suppresses duplicate signals during cooldown', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({
          signalCooldownSeconds: 3600,
          rapidSuccessiveDraws: { minCount: 3, windowSeconds: 300 },
          drawBurst: { minCount: 99, windowSeconds: 1 },
        }),
      );
      const t0 = Date.now();
      await service.observe(draw(t0));
      await service.observe(draw(t0 + 1_000));
      const first = await service.observe(draw(t0 + 2_000));
      expect(first.signals).toHaveLength(1);

      const second = await service.observe(draw(t0 + 3_000));
      expect(second.signals).toHaveLength(0);
    });

    it('is a no-op when disabled', async () => {
      service = new AnomalyDetectionService(
        repo,
        baseConfig({ enabled: false }),
      );
      const t0 = Date.now();
      for (let i = 0; i < 5; i++) {
        await service.observe(draw(t0 + i * 1_000));
      }
      const listed = await service.listSignals();
      expect(listed.total).toBe(0);
    });
  });

  describe('listSignals', () => {
    it('returns persisted signals with pagination metadata', async () => {
      const t0 = Date.now();
      await service.observe(draw(t0));
      await service.observe(draw(t0 + 1_000));
      await service.observe(draw(t0 + 2_000));

      const page = await service.listSignals({ limit: 10 });
      expect(page.total).toBeGreaterThanOrEqual(1);
      expect(page.signals.length).toBeGreaterThanOrEqual(1);
      expect(page.limit).toBe(10);
      expect(page.offset).toBe(0);
    });

    it('filters by correlationId', async () => {
      const t0 = Date.now();
      const corr = 'corr-test-123';
      await service.observe(draw(t0, '1', { correlationId: corr }));
      await service.observe(draw(t0 + 1_000, '1', { correlationId: corr }));
      await service.observe(draw(t0 + 2_000, '1', { correlationId: corr }));

      const page = await service.listSignals({ correlationId: corr });
      expect(page.total).toBeGreaterThanOrEqual(1);
      expect(page.signals.every((s) => s.correlationId === corr)).toBe(true);
    });
  });

  describe('loadAnomalyDetectionConfig', () => {
    it('applies env overrides', () => {
      const cfg = loadAnomalyDetectionConfig({
        ANOMALY_DETECTION_ENABLED: 'true',
        ANOMALY_RAPID_DRAWS_MIN_COUNT: '4',
        ANOMALY_RAPID_DRAWS_WINDOW_SECONDS: '120',
        ANOMALY_DRAW_BURST_MIN_COUNT: '6',
        ANOMALY_SIGNAL_COOLDOWN_SECONDS: '60',
      } as NodeJS.ProcessEnv);
      expect(cfg.rapidSuccessiveDraws.minCount).toBe(4);
      expect(cfg.rapidSuccessiveDraws.windowSeconds).toBe(120);
      expect(cfg.drawBurst.minCount).toBe(6);
      expect(cfg.signalCooldownSeconds).toBe(60);
    });

    it('falls back on invalid values', () => {
      const cfg = loadAnomalyDetectionConfig({
        ANOMALY_RAPID_DRAWS_MIN_COUNT: 'not-a-number',
      } as NodeJS.ProcessEnv);
      expect(cfg.rapidSuccessiveDraws.minCount).toBe(
        DEFAULT_ANOMALY_DETECTION_CONFIG.rapidSuccessiveDraws.minCount,
      );
    });
  });
});
