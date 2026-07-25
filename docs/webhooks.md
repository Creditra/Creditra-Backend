# Webhooks

Creditra has two webhook surfaces:

1. **Outbound** draw-confirmation deliveries to subscriber URLs (`WEBHOOK_URLS`).
2. **Inbound** signed partner events accepted at `POST /api/inbound-webhooks/events`.

Outbound onboarding for subscribers is documented in
[`webhook-subscribers.md`](./webhook-subscribers.md). This page documents the
**inbound** signature scheme partners must implement when calling Creditra.

---

## Inbound webhook signatures

Every inbound webhook must include:

```http
Content-Type: application/json
X-Timestamp: 2026-07-09T00:00:00.000Z
X-Nonce: unique-message-id
X-Signature: sha256=<hex HMAC>
```

| Header | Required | Description |
|---|---|---|
| `X-Timestamp` | yes | ISO-8601 (`Date.toISOString()`) **or** unix epoch seconds |
| `X-Nonce` | yes | Unique message id (UUID recommended). Max 256 characters. |
| `X-Signature` | yes | `sha256=` + lowercase/uppercase hex HMAC-SHA256 digest |

### Signing string

The signature is HMAC-SHA256 over the exact raw JSON request body plus the
timestamp and nonce, joined with dots:

```text
signed_payload = X-Timestamp + "." + X-Nonce + "." + raw_body
X-Signature    = "sha256=" + hex(hmac_sha256(INBOUND_WEBHOOK_SECRET, signed_payload))
```

**Critical:** sign the **raw body bytes** that will be sent on the wire.
Re-serializing JSON (key order, spacing, unicode escapes) changes the HMAC
input and will fail verification.

### Server rejection rules

The server rejects requests that fail any of these checks (fail closed):

| Condition | HTTP | Error |
|---|---:|---|
| `INBOUND_WEBHOOK_SECRET` unset | 503 | Inbound webhook signing is not configured… |
| Missing `X-Timestamp` / `X-Nonce` / `X-Signature` | 401 | Missing required webhook headers… |
| Unparseable timestamp | 401 | Invalid webhook timestamp |
| Timestamp outside tolerance | 401 | Stale webhook timestamp |
| Malformed `X-Signature` | 401 | Malformed webhook signature |
| HMAC mismatch | 401 | Invalid webhook signature |
| Nonce already seen inside the window | 401 | Replay detected |

Default timestamp tolerance is **5 minutes** (clock skew + delivery delay).
Configure with `INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS`.

### Replay protection

1. Signature and timestamp are verified first.
2. Only then is the nonce **claimed** in a TTL cache.
3. A second request with the same `X-Nonce` while the claim is live returns `401 Replay detected`.

The application ships an in-process nonce store (single-node / tests). Durable
multi-replica deployments can persist nonces with migration
`006_inbound_webhook_nonces.sql` (`inbound_webhook_nonces` table).

Nonce TTL aligns with the timestamp tolerance window so expired nonces do not
accumulate forever.

### Configuration

| Environment variable | Default | Used for |
|---|---:|---|
| `INBOUND_WEBHOOK_SECRET` | empty | Shared HMAC secret. Required to accept inbound webhooks. |
| `INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS` | `300000` (5 min) | Max absolute skew between server clock and `X-Timestamp`. |

Do **not** put real secrets in logs, tickets, sample payloads, or OpenAPI examples.

### Endpoint

```http
POST /api/inbound-webhooks/events
```

- **Auth:** signature headers only (no API key).
- **Body:** JSON object. Include an `event` string when possible.
- **Success 202:**

```json
{
  "data": { "accepted": true, "event": "partner.updated" },
  "error": null
}
```

### Partner signing example (Node.js)

```ts
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.INBOUND_WEBHOOK_SECRET!;
const timestamp = new Date().toISOString();
const nonce = randomUUID();
const body = JSON.stringify({ event: "partner.updated", id: "evt_123" });

const signature =
  "sha256=" +
  createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.`)
    .update(body)
    .digest("hex");

await fetch("https://api.example.com/api/inbound-webhooks/events", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-timestamp": timestamp,
    "x-nonce": nonce,
    "x-signature": signature,
  },
  body,
});
```

### Implementation references

| Piece | Path |
|---|---|
| Raw body capture | [`src/middleware/rawBody.ts`](../src/middleware/rawBody.ts) |
| HMAC + replay middleware | [`src/middleware/inboundWebhookSignature.ts`](../src/middleware/inboundWebhookSignature.ts) |
| Nonce store | [`src/services/inboundWebhookNonceStore.ts`](../src/services/inboundWebhookNonceStore.ts) |
| Route | [`src/routes/inboundWebhooks.ts`](../src/routes/inboundWebhooks.ts) |
| OpenAPI | [`src/openapi.yaml`](../src/openapi.yaml) → `/api/inbound-webhooks/events` |
| SQL migration | [`migrations/006_inbound_webhook_nonces.sql`](../migrations/006_inbound_webhook_nonces.sql) |

---

## Outbound webhooks (summary)

Outbound `draw_confirmed` deliveries use a related but distinct contract:

- Headers: `X-Webhook-Signature`, `X-Webhook-Timestamp`
- Secret: `WEBHOOK_SECRET`
- Signing input: raw JSON body only (no nonce in the signed string)

See [`webhook-subscribers.md`](./webhook-subscribers.md) for the full subscriber guide.
