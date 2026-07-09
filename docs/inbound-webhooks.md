# Inbound Webhook Signatures

Creditra accepts signed partner webhooks at `POST /api/inbound-webhooks/events`.

Every inbound webhook must include:

```http
Content-Type: application/json
X-Timestamp: 2026-07-09T00:00:00.000Z
X-Nonce: unique-message-id
X-Signature: sha256=<hex HMAC>
```

The signature is HMAC-SHA256 over the exact raw JSON request body plus the timestamp and nonce:

```text
hex(hmac_sha256(INBOUND_WEBHOOK_SECRET, X-Timestamp + "." + X-Nonce + "." + raw_body))
```

The server rejects:

- missing or malformed signature headers
- signatures that do not match in constant time
- timestamps outside `INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS` (default 5 minutes)
- repeated `X-Nonce` values inside the freshness window
- requests when `INBOUND_WEBHOOK_SECRET` is not configured

## Replay Protection

The nonce is claimed after signature and timestamp verification. A second request with the same nonce inside the timestamp tolerance window receives `401 Replay detected`.

The application ships an in-process nonce store for tests and single-process deployments, plus migration `006_inbound_webhook_nonces.sql` for durable deployments that back the nonce cache with PostgreSQL.

## Example

```ts
import { createHmac } from "node:crypto";

const timestamp = new Date().toISOString();
const nonce = crypto.randomUUID();
const body = JSON.stringify({ event: "partner.updated" });
const signature = createHmac("sha256", process.env.INBOUND_WEBHOOK_SECRET!)
  .update(`${timestamp}.${nonce}.`)
  .update(body)
  .digest("hex");

await fetch("https://api.example.com/api/inbound-webhooks/events", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-timestamp": timestamp,
    "x-nonce": nonce,
    "x-signature": `sha256=${signature}`,
  },
  body,
});
```
