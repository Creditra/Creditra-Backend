-- Add interest_rate_bps column to credit_lines table
-- This field stores the interest rate in basis points (e.g., 500 = 5%)

ALTER TABLE credit_lines 
ADD COLUMN interest_rate_bps INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN credit_lines.interest_rate_bps IS 'Interest rate in basis points (e.g., 500 = 5%)';

-- Add index for queries filtering by interest rate
CREATE INDEX credit_lines_interest_rate_bps_idx ON credit_lines (interest_rate_bps);