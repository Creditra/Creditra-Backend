/**
 * Rules-based anomaly detection for rapid draw / repay patterns.
 *
 * Pipeline:
 *  1. Activity (draw/repay) is recorded into a per-credit-line sliding buffer.
 *  2. Explainable rules evaluate the buffer against configured thresholds.
 *  3. Firing rules persist {@link RiskSignal} rows for operator review.
 *
 * Detection never blocks the credit path — failures here are isolated and
 * logged. See `docs/ANOMALY_DETECTION.md`.
 */

import { randomUUID } from 'crypto';
import type {
  AnomalyDetectionConfig,
} from '../config/anomalyDetection.js';
import {
  DEFAULT_ANOMALY_DETECTION_CONFIG,
  loadAnomalyDetectionConfig,
} from '../config/anomalyDetection.js';
import type {
  CreateRiskSignalInput,
  RiskSignal,
  RiskSignalRuleId,
  RiskSignalSeverity,
  RiskSignalType,
} from '../models/RiskSignal.js';
import type {
  RiskSignalListFilters,
  RiskSignalRepository,
} from '../repositories/interfaces/RiskSignalRepository.js';

export type ActivityKind = 'draw' | 'repay';

export interface ActivityEvent {
  kind: ActivityKind;
  creditLineId: string;
  walletAddress: string;
  amount: string;
  /** Epoch milliseconds. */
  occurredAtMs: number;
  /** Optional external correlation (e.g. request id); generated if omitted. */
  correlationId?: string;
}

export interface FiredRule {
  signalType: RiskSignalType;
  ruleId: RiskSignalRuleId;
  severity: RiskSignalSeverity;
  thresholds: Record<string, number | string | boolean>;
  evidence: Record<string, unknown>;
}

export interface EvaluateResult {
  correlationId: string;
  signals: RiskSignal[];
  firedRules: FiredRule[];
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

export class AnomalyDetectionService {
  private readonly config: AnomalyDetectionConfig;
  /** creditLineId → chronological activity (newest last). */
  private readonly activity = new Map<string, ActivityEvent[]>();
  /** `${creditLineId}:${ruleId}` → last fired epoch ms (cooldown). */
  private readonly lastFired = new Map<string, number>();

  constructor(
    private readonly repository: RiskSignalRepository,
    config: AnomalyDetectionConfig = loadAnomalyDetectionConfig(),
  ) {
    this.config = config;
  }

  getConfig(): AnomalyDetectionConfig {
    return this.config;
  }

  /**
   * Record a draw/repay activity event and evaluate all rules.
   * Returns any newly persisted signals (may be empty).
   */
  async observe(event: ActivityEvent): Promise<EvaluateResult> {
    const correlationId = event.correlationId ?? randomUUID();
    if (!this.config.enabled) {
      return { correlationId, signals: [], firedRules: [] };
    }

    const normalized: ActivityEvent = {
      ...event,
      correlationId,
      amount: event.amount,
    };
    this.pushActivity(normalized);

    const fired = this.evaluateRules(normalized.creditLineId, correlationId);
    const signals: RiskSignal[] = [];

    for (const rule of fired) {
      if (this.isCoolingDown(normalized.creditLineId, rule.ruleId, normalized.occurredAtMs)) {
        continue;
      }

      const input: CreateRiskSignalInput = {
        signalType: rule.signalType,
        ruleId: rule.ruleId,
        severity: rule.severity,
        walletAddress: normalized.walletAddress,
        creditLineId: normalized.creditLineId,
        correlationId,
        thresholds: rule.thresholds,
        evidence: rule.evidence,
        status: 'open',
      };

      const saved = await this.repository.create(input);
      this.lastFired.set(
        cooldownKey(normalized.creditLineId, rule.ruleId),
        normalized.occurredAtMs,
      );
      signals.push(saved);
    }

    return { correlationId, signals, firedRules: fired };
  }

  /** Evaluate rules without persisting (pure; used by unit tests). */
  evaluateOnly(
    creditLineId: string,
    correlationId = randomUUID(),
  ): FiredRule[] {
    return this.evaluateRules(creditLineId, correlationId);
  }

  async listSignals(filters: RiskSignalListFilters = {}): Promise<{
    signals: RiskSignal[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const offset = Math.max(0, filters.offset ?? 0);
    let limit = filters.limit ?? DEFAULT_LIST_LIMIT;
    if (limit <= 0) limit = DEFAULT_LIST_LIMIT;
    if (limit > MAX_LIST_LIMIT) limit = MAX_LIST_LIMIT;

    const query: RiskSignalListFilters = {
      ...filters,
      offset,
      limit,
    };
    const [signals, total] = await Promise.all([
      this.repository.findMany(query),
      this.repository.count({
        walletAddress: filters.walletAddress,
        creditLineId: filters.creditLineId,
        signalType: filters.signalType,
        status: filters.status,
        correlationId: filters.correlationId,
      }),
    ]);
    return { signals, total, offset, limit };
  }

  async getSignal(id: string): Promise<RiskSignal | null> {
    return this.repository.findById(id);
  }

  /** Test helper: inject activity without evaluation. */
  seedActivity(events: ActivityEvent[]): void {
    for (const event of events) {
      this.pushActivity({
        ...event,
        correlationId: event.correlationId ?? randomUUID(),
      });
    }
  }

  /** Test helper. */
  clearState(): void {
    this.activity.clear();
    this.lastFired.clear();
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  private evaluateRules(creditLineId: string, correlationId: string): FiredRule[] {
    const events = this.activity.get(creditLineId) ?? [];
    if (events.length === 0) return [];

    const fired: FiredRule[] = [];
    const rapid = this.ruleRapidSuccessiveDraws(events, correlationId);
    if (rapid) fired.push(rapid);

    const burst = this.ruleDrawBurst(events, correlationId);
    if (burst) fired.push(burst);

    const repay = this.ruleUnusualRepayPattern(events, correlationId);
    if (repay) fired.push(repay);

    return fired;
  }

  private ruleRapidSuccessiveDraws(
    events: ActivityEvent[],
    correlationId: string,
  ): FiredRule | null {
    const { minCount, windowSeconds } = this.config.rapidSuccessiveDraws;
    const windowMs = windowSeconds * 1000;
    const latest = events[events.length - 1];
    if (!latest || latest.kind !== 'draw') return null;

    const windowStart = latest.occurredAtMs - windowMs;
    const draws = events.filter(
      (e) => e.kind === 'draw' && e.occurredAtMs >= windowStart,
    );
    if (draws.length < minCount) return null;

    return {
      signalType: 'rapid_successive_draws',
      ruleId: 'rule.rapid_successive_draws',
      severity: 'medium',
      thresholds: {
        minCount,
        windowSeconds,
        rule: 'rapid_successive_draws',
      },
      evidence: {
        correlationId,
        drawCount: draws.length,
        windowStartIso: new Date(windowStart).toISOString(),
        windowEndIso: new Date(latest.occurredAtMs).toISOString(),
        amounts: draws.map((d) => d.amount),
        occurredAt: draws.map((d) => new Date(d.occurredAtMs).toISOString()),
      },
    };
  }

  private ruleDrawBurst(
    events: ActivityEvent[],
    correlationId: string,
  ): FiredRule | null {
    const { minCount, windowSeconds } = this.config.drawBurst;
    const windowMs = windowSeconds * 1000;
    const latest = events[events.length - 1];
    if (!latest || latest.kind !== 'draw') return null;

    const windowStart = latest.occurredAtMs - windowMs;
    const draws = events.filter(
      (e) => e.kind === 'draw' && e.occurredAtMs >= windowStart,
    );
    if (draws.length < minCount) return null;

    return {
      signalType: 'draw_burst',
      ruleId: 'rule.draw_burst',
      severity: 'high',
      thresholds: {
        minCount,
        windowSeconds,
        rule: 'draw_burst',
      },
      evidence: {
        correlationId,
        drawCount: draws.length,
        windowStartIso: new Date(windowStart).toISOString(),
        windowEndIso: new Date(latest.occurredAtMs).toISOString(),
        amounts: draws.map((d) => d.amount),
        occurredAt: draws.map((d) => new Date(d.occurredAtMs).toISOString()),
      },
    };
  }

  private ruleUnusualRepayPattern(
    events: ActivityEvent[],
    correlationId: string,
  ): FiredRule | null {
    const {
      minCycles,
      pairWindowSeconds,
      patternWindowSeconds,
      amountToleranceRatio,
    } = this.config.unusualRepayPattern;

    const latest = events[events.length - 1];
    if (!latest || latest.kind !== 'repay') return null;

    const patternMs = patternWindowSeconds * 1000;
    const pairMs = pairWindowSeconds * 1000;
    const windowStart = latest.occurredAtMs - patternMs;
    const recent = events.filter((e) => e.occurredAtMs >= windowStart);

    const cycles: Array<{
      drawAmount: string;
      repayAmount: string;
      drawAt: string;
      repayAt: string;
      deltaSeconds: number;
    }> = [];

    // Greedy pair: each repay matches the most recent unpaired prior draw
    // within pairWindowSeconds and amount tolerance.
    const unpairedDraws: ActivityEvent[] = [];
    for (const e of recent) {
      if (e.kind === 'draw') {
        unpairedDraws.push(e);
        continue;
      }
      // repay
      for (let i = unpairedDraws.length - 1; i >= 0; i--) {
        const draw = unpairedDraws[i];
        const delta = e.occurredAtMs - draw.occurredAtMs;
        if (delta < 0 || delta > pairMs) continue;
        if (!amountsWithinTolerance(draw.amount, e.amount, amountToleranceRatio)) {
          continue;
        }
        cycles.push({
          drawAmount: draw.amount,
          repayAmount: e.amount,
          drawAt: new Date(draw.occurredAtMs).toISOString(),
          repayAt: new Date(e.occurredAtMs).toISOString(),
          deltaSeconds: Math.round(delta / 1000),
        });
        unpairedDraws.splice(i, 1);
        break;
      }
    }

    if (cycles.length < minCycles) return null;

    return {
      signalType: 'unusual_repay_pattern',
      ruleId: 'rule.unusual_repay_pattern',
      severity: 'high',
      thresholds: {
        minCycles,
        pairWindowSeconds,
        patternWindowSeconds,
        amountToleranceRatio,
        rule: 'unusual_repay_pattern',
      },
      evidence: {
        correlationId,
        cycleCount: cycles.length,
        cycles,
        windowStartIso: new Date(windowStart).toISOString(),
        windowEndIso: new Date(latest.occurredAtMs).toISOString(),
      },
    };
  }

  // ── Buffer helpers ───────────────────────────────────────────────────────

  private pushActivity(event: ActivityEvent): void {
    const list = this.activity.get(event.creditLineId) ?? [];
    list.push(event);

    // Drop events older than the widest configured window (plus small margin).
    const maxWindowSec = Math.max(
      this.config.rapidSuccessiveDraws.windowSeconds,
      this.config.drawBurst.windowSeconds,
      this.config.unusualRepayPattern.patternWindowSeconds,
    );
    const cutoff = event.occurredAtMs - maxWindowSec * 1000 * 2;
    let trimmed = list.filter((e) => e.occurredAtMs >= cutoff);

    const max = this.config.maxActivityEventsPerLine;
    if (trimmed.length > max) {
      trimmed = trimmed.slice(trimmed.length - max);
    }

    this.activity.set(event.creditLineId, trimmed);
  }

  private isCoolingDown(
    creditLineId: string,
    ruleId: RiskSignalRuleId,
    nowMs: number,
  ): boolean {
    const last = this.lastFired.get(cooldownKey(creditLineId, ruleId));
    if (last === undefined) return false;
    return nowMs - last < this.config.signalCooldownSeconds * 1000;
  }
}

function cooldownKey(creditLineId: string, ruleId: string): string {
  return `${creditLineId}:${ruleId}`;
}

function amountsWithinTolerance(
  drawAmount: string,
  repayAmount: string,
  toleranceRatio: number,
): boolean {
  const d = Number.parseFloat(drawAmount);
  const r = Number.parseFloat(repayAmount);
  if (!Number.isFinite(d) || !Number.isFinite(r) || d === 0) return false;
  return Math.abs(d - r) / Math.abs(d) <= toleranceRatio;
}

/** Factory using default env config — handy for tests that only need pure rules. */
export function createAnomalyDetectionService(
  repository: RiskSignalRepository,
  config: AnomalyDetectionConfig = DEFAULT_ANOMALY_DETECTION_CONFIG,
): AnomalyDetectionService {
  return new AnomalyDetectionService(repository, config);
}
