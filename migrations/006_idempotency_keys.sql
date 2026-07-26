-- Idempotency cache for POST mutations.
-- Values are scoped by key, route, and principal so two callers can safely use
-- the same client-generated key on different authenticated scopes.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  principal_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT idempotency_keys_status_check
    CHECK (status IN ('pending', 'completed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_scope_key
  ON idempotency_keys (key_hash, scope, principal_hash);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx
  ON idempotency_keys (expires_at);

COMMENT ON TABLE idempotency_keys IS 'POST mutation idempotency cache with TTL';
