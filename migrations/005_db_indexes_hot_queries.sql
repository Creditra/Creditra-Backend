-- Migration 005: Database indexes for hot queries
-- Covers credit lines by borrower (wallet address) and transaction history by borrower.

-- Index: look up all credit lines for a given borrower wallet address
CREATE INDEX IF NOT EXISTS idx_credit_lines_wallet_address
  ON credit_lines (wallet_address);

-- Index: transaction history by credit line (already FK, but explicit index for range scans)
CREATE INDEX IF NOT EXISTS idx_transactions_credit_line_id
  ON transactions (credit_line_id);

-- Index: transaction history filtered by type (draw/repay)
CREATE INDEX IF NOT EXISTS idx_transactions_type
  ON transactions (type);

-- Composite: filter transactions by credit_line_id + type (most common history query)
CREATE INDEX IF NOT EXISTS idx_transactions_credit_line_type
  ON transactions (credit_line_id, type);

-- Composite: filter transactions by credit_line_id + created_at for date-range queries
CREATE INDEX IF NOT EXISTS idx_transactions_credit_line_created
  ON transactions (credit_line_id, created_at DESC);

-- Index: support listing all credit lines by status (e.g. ACTIVE / SUSPENDED)
CREATE INDEX IF NOT EXISTS idx_credit_lines_status
  ON credit_lines (status);

-- Partial index: only ACTIVE credit lines (most frequent filter in dashboard queries)
CREATE INDEX IF NOT EXISTS idx_credit_lines_active
  ON credit_lines (wallet_address, created_at DESC)
  WHERE status = 'ACTIVE';

INSERT INTO schema_migrations (version) VALUES ('005_db_indexes_hot_queries')
  ON CONFLICT (version) DO NOTHING;
