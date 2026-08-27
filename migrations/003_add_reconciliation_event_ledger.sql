-- Immutable provider-event ledger. A unique event_id is the idempotency
-- boundary; payload_fingerprint makes identity reuse with changed data a
-- detectable conflict instead of a silent overwrite.
CREATE TABLE IF NOT EXISTS reconciliation_event_ledger (
  event_id TEXT PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_event_ledger_aggregate_idx
  ON reconciliation_event_ledger (aggregate_id, recorded_at);

CREATE TABLE IF NOT EXISTS reconciliation_event_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('conflict', 'rollback')),
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_event_audits_event_idx
  ON reconciliation_event_audits (event_id, created_at);
