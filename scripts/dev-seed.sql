-- Deterministic local-only seed data for scripts/dev-bootstrap.sh.
-- Values are placeholders for development and must not be reused as credentials.
-- Safe to re-run: inserts are guarded with NOT EXISTS / ON CONFLICT.

WITH borrower AS (
  INSERT INTO borrowers (wallet_address)
  VALUES ('GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA')
  ON CONFLICT (wallet_address) DO UPDATE
    SET updated_at = now()
  RETURNING id
),
credit_line AS (
  INSERT INTO credit_lines (
    borrower_id,
    credit_limit,
    currency,
    status,
    interest_rate_bps
  )
  SELECT id, 1000.00000000, 'USDC', 'active', 750
  FROM borrower
  WHERE NOT EXISTS (
    SELECT 1
    FROM credit_lines cl
    JOIN borrowers b ON b.id = cl.borrower_id
    WHERE b.wallet_address = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA'
  )
  RETURNING id, borrower_id
),
-- Prefer the row just inserted (via RETURNING). Sibling CTEs cannot see each
-- other's table mutations under a single snapshot, so fall back to a SELECT
-- only when the insert CTE was a no-op.
selected_credit_line AS (
  SELECT id, borrower_id FROM credit_line
  UNION ALL
  SELECT cl.id, cl.borrower_id
  FROM credit_lines cl
  JOIN borrowers b ON b.id = cl.borrower_id
  WHERE b.wallet_address = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA'
    AND NOT EXISTS (SELECT 1 FROM credit_line)
),
risk_seed AS (
  INSERT INTO risk_evaluations (
    borrower_id,
    risk_score,
    suggested_limit,
    interest_rate_bps,
    inputs,
    evaluated_at,
    expires_at
  )
  SELECT
    borrower_id,
    82,
    1000.00000000,
    750,
    '[{"name":"local_seed","value":82,"weight":1,"description":"Deterministic local development seed"}]'::jsonb,
    now(),
    now() + interval '7 days'
  FROM selected_credit_line
  WHERE NOT EXISTS (
    SELECT 1
    FROM risk_evaluations re
    WHERE re.borrower_id = selected_credit_line.borrower_id
      AND re.inputs @> '[{"name":"local_seed"}]'::jsonb
  )
  RETURNING id
)
INSERT INTO transactions (
  credit_line_id,
  type,
  amount,
  currency,
  status,
  blockchain_tx_hash,
  processed_at
)
SELECT
  scl.id,
  'borrow',
  125.00000000,
  'USDC',
  'confirmed',
  'local-seed-tx-001',
  now()
FROM selected_credit_line scl
-- Reference risk_seed so the data-modifying CTE is never optimised away.
CROSS JOIN LATERAL (SELECT count(*) AS n FROM risk_seed) rs
WHERE NOT EXISTS (
  SELECT 1
  FROM transactions tx
  WHERE tx.credit_line_id = scl.id
    AND tx.blockchain_tx_hash = 'local-seed-tx-001'
);
