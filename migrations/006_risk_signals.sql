-- Risk signals: rules-based anomaly detection outputs for operator review.
-- See docs/ANOMALY_DETECTION.md and docs/data-model.md.

CREATE TABLE IF NOT EXISTS risk_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  credit_line_id UUID,
  correlation_id TEXT NOT NULL,
  thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT risk_signals_severity_check
    CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT risk_signals_status_check
    CHECK (status IN ('open', 'acknowledged', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS risk_signals_wallet_address_idx
  ON risk_signals (wallet_address);

CREATE INDEX IF NOT EXISTS risk_signals_credit_line_id_idx
  ON risk_signals (credit_line_id);

CREATE INDEX IF NOT EXISTS risk_signals_created_at_idx
  ON risk_signals (created_at DESC);

CREATE INDEX IF NOT EXISTS risk_signals_signal_type_idx
  ON risk_signals (signal_type);

CREATE INDEX IF NOT EXISTS risk_signals_correlation_id_idx
  ON risk_signals (correlation_id);

CREATE INDEX IF NOT EXISTS risk_signals_status_created_at_idx
  ON risk_signals (status, created_at DESC);

COMMENT ON TABLE risk_signals IS
  'Anomaly detection risk signals (rapid draws, draw bursts, unusual repay patterns); advisory only';
COMMENT ON COLUMN risk_signals.correlation_id IS
  'Links signal to the activity evaluation that produced it (for audit/trace)';
COMMENT ON COLUMN risk_signals.thresholds IS
  'Explainable snapshot of rule thresholds at evaluation time';
COMMENT ON COLUMN risk_signals.evidence IS
  'Activity window / amounts / counts that caused the rule to fire';
