-- One open (non-closed) credit line per borrower.
-- Closed lines may be retained for history; opening another is allowed only
-- after the previous open line is closed. Unique violations map to HTTP 409.
-- See issue #227 (consistent conflict detection).

CREATE UNIQUE INDEX IF NOT EXISTS credit_lines_one_open_per_borrower
  ON credit_lines (borrower_id)
  WHERE status IS DISTINCT FROM 'closed';

COMMENT ON INDEX credit_lines_one_open_per_borrower IS
  'At most one non-closed credit line per borrower; duplicates return 409';
