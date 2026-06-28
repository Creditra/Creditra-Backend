-- Add columns required by the model layer so that PostgresRiskEvaluationRepository
-- and PostgresTransactionRepository can persist every field the in-memory
-- repositories track (see src/models/Transaction.ts and src/models/RiskEvaluation.ts).

-- Transactions: lifecycle status, settlement time and the on-chain tx hash.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blockchain_tx_hash TEXT;

COMMENT ON COLUMN transactions.status IS 'Lifecycle status: pending, confirmed, failed, cancelled';

CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);

-- Risk evaluations: expiry timestamp drives the isValid()/deleteExpired() paths.
ALTER TABLE risk_evaluations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS risk_evaluations_expires_at_idx ON risk_evaluations (expires_at);
