-- Creditra Backend — Initial PostgreSQL schema
-- See docs/data-model.md for full documentation.
-- Apply in order; track applied migrations (e.g. schema_migrations table) in your deployment.

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migration tracking (optional but recommended)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Borrowers: identities (e.g. wallet addresses) that hold credit lines
CREATE TABLE borrowers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX borrowers_wallet_address_key ON borrowers (wallet_address);

COMMENT ON TABLE borrowers IS 'Borrower identities; wallet_address is the natural key';

-- Credit lines: per-borrower credit facilities
CREATE TABLE credit_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id UUID NOT NULL REFERENCES borrowers(id) ON DELETE RESTRICT,
  credit_limit NUMERIC(28,8) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX credit_lines_borrower_id_idx ON credit_lines (borrower_id);
CREATE INDEX credit_lines_status_idx ON credit_lines (status);
CREATE INDEX credit_lines_borrower_status_idx ON credit_lines (borrower_id, status);

COMMENT ON TABLE credit_lines IS 'Credit facilities per borrower; status e.g. active, closed, suspended';

-- Risk evaluations: historical risk scores and suggested terms per borrower
CREATE TABLE risk_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id UUID NOT NULL REFERENCES borrowers(id) ON DELETE RESTRICT,
  risk_score INTEGER NOT NULL,
  suggested_limit NUMERIC(28,8) NOT NULL,
  interest_rate_bps INTEGER NOT NULL,
  inputs JSONB,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX risk_evaluations_borrower_id_idx ON risk_evaluations (borrower_id);
CREATE INDEX risk_evaluations_evaluated_at_idx ON risk_evaluations (evaluated_at DESC);

COMMENT ON TABLE risk_evaluations IS 'Historical risk evaluations; inputs is optional snapshot of evaluation inputs';

-- Transactions: draws and repayments against a credit line
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_line_id UUID NOT NULL REFERENCES credit_lines(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  amount NUMERIC(28,8) NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transactions_credit_line_id_idx ON transactions (credit_line_id);
CREATE INDEX transactions_credit_line_created_at_idx ON transactions (credit_line_id, created_at);

COMMENT ON TABLE transactions IS 'Draws (positive) and repayments (negative) per credit line';

-- Events: immutable domain/audit events (e.g. from Horizon); idempotency via idempotency_key
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT,
  aggregate_id UUID,
  payload JSONB,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX events_idempotency_key_key ON events (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX events_aggregate_idx ON events (aggregate_type, aggregate_id);
CREATE INDEX events_created_at_idx ON events (created_at);

COMMENT ON TABLE events IS 'Immutable domain events; idempotency_key deduplicates ingestion';

-- Version is recorded by the migration runner after this file is applied.
