-- Add a monotonic version used by optimistic concurrency checks.
-- Existing rows start at one so the API can be rolled out without null states.
ALTER TABLE credit_lines
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN credit_lines.version IS
  'Monotonic optimistic-concurrency version; incremented with every successful update';

-- Rollback: IRREVERSIBLE - dropping this column removes OCC guarantees for credit lines.
