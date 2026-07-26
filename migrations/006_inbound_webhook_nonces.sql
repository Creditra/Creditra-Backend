-- Replay protection store for inbound signed webhooks.
CREATE TABLE IF NOT EXISTS inbound_webhook_nonces (
  nonce TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS inbound_webhook_nonces_expires_at_idx
  ON inbound_webhook_nonces (expires_at);

COMMENT ON TABLE inbound_webhook_nonces IS 'Nonce cache for inbound webhook replay protection';
