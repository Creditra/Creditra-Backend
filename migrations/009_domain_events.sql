-- Append-only store for credit lifecycle domain events (replay, reconciliation, audits).
-- The (aggregate_id, event_type, occurred_at) triple is the idempotency key: the same
-- domain event republished after a crash-before-ack is a no-op, not a duplicate row.

CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS domain_events_idempotency_key
  ON domain_events (aggregate_id, event_type, occurred_at);

CREATE INDEX IF NOT EXISTS domain_events_aggregate_id_idx
  ON domain_events (aggregate_id, occurred_at);

CREATE INDEX IF NOT EXISTS domain_events_event_type_idx
  ON domain_events (event_type, occurred_at);
