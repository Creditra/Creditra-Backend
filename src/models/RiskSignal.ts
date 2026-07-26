/**
 * Persisted risk signal produced by the rules-based anomaly detection pipeline.
 *
 * Signals are advisory: they never block draws/repays. Operators review them
 * via the admin list endpoint. Thresholds and evidence are stored so every
 * signal is explainable at audit time.
 */

export type RiskSignalType =
  | 'rapid_successive_draws'
  | 'draw_burst'
  | 'unusual_repay_pattern';

export type RiskSignalSeverity = 'low' | 'medium' | 'high';

export type RiskSignalStatus = 'open' | 'acknowledged' | 'dismissed';

/** Stable rule identifiers (documented in docs/ANOMALY_DETECTION.md). */
export type RiskSignalRuleId =
  | 'rule.rapid_successive_draws'
  | 'rule.draw_burst'
  | 'rule.unusual_repay_pattern';

export interface RiskSignal {
  id: string;
  signalType: RiskSignalType;
  ruleId: RiskSignalRuleId;
  severity: RiskSignalSeverity;
  walletAddress: string;
  creditLineId: string;
  /** Correlates the signal to the activity evaluation that produced it. */
  correlationId: string;
  /** Snapshot of rule thresholds at evaluation time (explainability). */
  thresholds: Record<string, number | string | boolean>;
  /** Concrete activity that triggered the rule. */
  evidence: Record<string, unknown>;
  status: RiskSignalStatus;
  createdAt: Date;
}

export interface CreateRiskSignalInput {
  signalType: RiskSignalType;
  ruleId: RiskSignalRuleId;
  severity: RiskSignalSeverity;
  walletAddress: string;
  creditLineId: string;
  correlationId: string;
  thresholds: Record<string, number | string | boolean>;
  evidence: Record<string, unknown>;
  status?: RiskSignalStatus;
}
