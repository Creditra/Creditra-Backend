-- Replay protection store for inbound signed webhooks.
-- Application code ships an in-process TTL cache; durable multi-replica
-- deployments can back the same contract with this table.
CREATE TABLE IF NOT EXISTS inbound_webhook_nonces (
  nonce TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS inbound_webhook_nonces_expires_at_idx
  ON inbound_webhook_nonces (expires_at);

COMMENT ON TABLE inbound_webhook_nonces IS
  'Nonce cache for inbound webhook replay protection (HMAC + timestamp window)';

-- Rollback (manual):
-- DROP INDEX IF EXISTS inbound_webhook_nonces_expires_at_idx;
-- DROP TABLE IF EXISTS inbound_webhook_nonces;
