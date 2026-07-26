-- Durable outbound webhook subscriptions and delivery attempts.
-- Secrets are referenced by name (for example WEBHOOK_SECRET), never stored.

CREATE TABLE IF NOT EXISTS outbound_webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  secret_ref TEXT NOT NULL DEFAULT 'WEBHOOK_SECRET',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outbound_webhook_subscriptions_url_key
  ON outbound_webhook_subscriptions (url);

CREATE INDEX IF NOT EXISTS outbound_webhook_subscriptions_active_idx
  ON outbound_webhook_subscriptions (active);

CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
    REFERENCES outbound_webhook_subscriptions(id) ON DELETE RESTRICT,
  url TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'delivered', 'failed', 'dead_letter')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outbound_webhook_deliveries_event_subscription_key
  ON outbound_webhook_deliveries (subscription_id, event_id)
  WHERE status = 'delivered';

CREATE INDEX IF NOT EXISTS outbound_webhook_deliveries_status_idx
  ON outbound_webhook_deliveries (status, created_at DESC);

CREATE INDEX IF NOT EXISTS outbound_webhook_deliveries_event_idx
  ON outbound_webhook_deliveries (event_type, event_id);

COMMENT ON TABLE outbound_webhook_subscriptions IS
  'Outbound webhook subscribers; secret_ref points to environment-managed secret material.';

COMMENT ON TABLE outbound_webhook_deliveries IS
  'Durable outbound webhook delivery attempts, retries, and dead-letter records.';
