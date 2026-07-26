/**
 * Anomaly detection configuration for rapid draw/repay risk signals.
 *
 * All thresholds are explainable and env-overridable. Defaults are conservative
 * enough for tests and local dev while still flagging clearly suspicious bursts.
 *
 * See `docs/ANOMALY_DETECTION.md` for rule semantics and rationale.
 */

export interface AnomalyDetectionConfig {
  /** Master switch. When false, the subscriber is a no-op. */
  enabled: boolean;

  /**
   * rapid_successive_draws — medium severity.
   * Fires when `minCount` draws occur on the same credit line within `windowSeconds`.
   */
  rapidSuccessiveDraws: {
    minCount: number;
    windowSeconds: number;
  };

  /**
   * draw_burst — high severity.
   * Fires when `minCount` draws occur on the same credit line within a short
   * `windowSeconds` burst window (stricter than rapid successive draws).
   */
  drawBurst: {
    minCount: number;
    windowSeconds: number;
  };

  /**
   * unusual_repay_pattern — high severity.
   * Fires when at least `minCycles` draw→repay pairs occur where each repay
   * lands within `pairWindowSeconds` of its draw, amounts are within
   * `amountToleranceRatio` of each other, and the whole pattern fits inside
   * `patternWindowSeconds`.
   */
  unusualRepayPattern: {
    minCycles: number;
    pairWindowSeconds: number;
    patternWindowSeconds: number;
    /** Absolute relative difference |draw-repay|/draw allowed (e.g. 0.1 = 10%). */
    amountToleranceRatio: number;
  };

  /**
   * Per (creditLineId, ruleId) cooldown in seconds. Suppresses duplicate
   * signals for the same rule/line while the suspicious window is still open.
   */
  signalCooldownSeconds: number;

  /** Max in-memory activity events retained per credit line. */
  maxActivityEventsPerLine: number;
}

export const DEFAULT_ANOMALY_DETECTION_CONFIG: AnomalyDetectionConfig = {
  enabled: true,
  rapidSuccessiveDraws: {
    minCount: 3,
    windowSeconds: 300,
  },
  drawBurst: {
    minCount: 5,
    windowSeconds: 60,
  },
  unusualRepayPattern: {
    minCycles: 2,
    pairWindowSeconds: 120,
    patternWindowSeconds: 600,
    amountToleranceRatio: 0.1,
  },
  signalCooldownSeconds: 300,
  maxActivityEventsPerLine: 50,
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseNonNegativeRatio(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

/**
 * Load anomaly detection config from environment variables.
 * Unknown or invalid values fall back to {@link DEFAULT_ANOMALY_DETECTION_CONFIG}.
 */
export function loadAnomalyDetectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnomalyDetectionConfig {
  const d = DEFAULT_ANOMALY_DETECTION_CONFIG;
  return {
    enabled: parseBool(env.ANOMALY_DETECTION_ENABLED, d.enabled),
    rapidSuccessiveDraws: {
      minCount: parsePositiveInt(
        env.ANOMALY_RAPID_DRAWS_MIN_COUNT,
        d.rapidSuccessiveDraws.minCount,
      ),
      windowSeconds: parsePositiveInt(
        env.ANOMALY_RAPID_DRAWS_WINDOW_SECONDS,
        d.rapidSuccessiveDraws.windowSeconds,
      ),
    },
    drawBurst: {
      minCount: parsePositiveInt(
        env.ANOMALY_DRAW_BURST_MIN_COUNT,
        d.drawBurst.minCount,
      ),
      windowSeconds: parsePositiveInt(
        env.ANOMALY_DRAW_BURST_WINDOW_SECONDS,
        d.drawBurst.windowSeconds,
      ),
    },
    unusualRepayPattern: {
      minCycles: parsePositiveInt(
        env.ANOMALY_REPAY_PATTERN_MIN_CYCLES,
        d.unusualRepayPattern.minCycles,
      ),
      pairWindowSeconds: parsePositiveInt(
        env.ANOMALY_REPAY_PAIR_WINDOW_SECONDS,
        d.unusualRepayPattern.pairWindowSeconds,
      ),
      patternWindowSeconds: parsePositiveInt(
        env.ANOMALY_REPAY_PATTERN_WINDOW_SECONDS,
        d.unusualRepayPattern.patternWindowSeconds,
      ),
      amountToleranceRatio: parseNonNegativeRatio(
        env.ANOMALY_REPAY_AMOUNT_TOLERANCE_RATIO,
        d.unusualRepayPattern.amountToleranceRatio,
      ),
    },
    signalCooldownSeconds: parsePositiveInt(
      env.ANOMALY_SIGNAL_COOLDOWN_SECONDS,
      d.signalCooldownSeconds,
    ),
    maxActivityEventsPerLine: parsePositiveInt(
      env.ANOMALY_MAX_ACTIVITY_EVENTS_PER_LINE,
      d.maxActivityEventsPerLine,
    ),
  };
}
