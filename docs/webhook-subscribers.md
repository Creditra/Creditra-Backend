# Webhook Subscriber Onboarding

Creditra sends outbound `draw_confirmed` webhooks to each URL configured in
`WEBHOOK_URLS`. Every delivery is signed with HMAC-SHA256 so subscribers can
verify that the raw request body came from a sender that knows
`WEBHOOK_SECRET`.

Implementation references:

- [`src/services/drawWebhookService.ts`](../src/services/drawWebhookService.ts)
- [`src/routes/webhook.ts`](../src/routes/webhook.ts)

## Delivery Configuration

| Environment variable | Default | Used for |
|---|---:|---|
| `WEBHOOK_URLS` | empty | Comma-separated subscriber URLs. No URLs means delivery is disabled. |
| `WEBHOOK_SECRET` | empty | Shared HMAC secret. Required when `WEBHOOK_URLS` is configured. |
| `WEBHOOK_MAX_RETRIES` | `3` | Retry attempts after the first delivery attempt. |
| `WEBHOOK_INITIAL_BACKOFF_MS` | `1000` | Initial retry delay in milliseconds. |
| `WEBHOOK_BACKOFF_MULTIPLIER` | `2.0` | Multiplier applied after each failed attempt. |
| `WEBHOOK_TIMEOUT_MS` | `10000` | Per-request timeout in milliseconds. |

Do not put real `WEBHOOK_SECRET` values in logs, docs, tickets, or sample
payloads.

## Request Contract

Creditra sends a `POST` request to each configured subscriber URL.

```http
Content-Type: application/json
X-Webhook-Signature: sha256=<hex HMAC over raw body>
X-Webhook-Timestamp: <payload ISO timestamp>
User-Agent: Creditra-Webhook/1.0
```

The signature is generated from the exact JSON string sent as the request body:

```text
hex(hmac_sha256(WEBHOOK_SECRET, raw_json_body))
```

Verify the signature before trusting any payload fields. Re-serializing the
payload can change spacing, key order, or encoding and produce a different HMAC
input. After signature verification, confirm the `X-Webhook-Timestamp` header
matches the signed payload `timestamp`, then apply your freshness window.

## Payload

The outbound payload shape is defined by `WebhookPayload` in
`drawWebhookService.ts`.

```json
{
  "event": "draw_confirmed",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "data": {
    "ledger": 123456,
    "contractId": "contract-1",
    "drawAmount": "100.00",
    "drawId": "draw-1",
    "borrowerWallet": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "creditLineId": "credit-line-1",
    "horizonTimestamp": "2026-01-01T00:00:00Z"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `event` | `"draw_confirmed"` | Fixed event name emitted by the draw webhook service. |
| `timestamp` | string | ISO timestamp created when Creditra builds the webhook payload. |
| `data.ledger` | number | Ledger from the Horizon event. |
| `data.contractId` | string | Contract id from the Horizon event. |
| `data.drawAmount` | string | Draw amount parsed from the Horizon event data, or `"0"` when absent. |
| `data.drawId` | string | Draw identifier parsed from the Horizon event data. |
| `data.borrowerWallet` | string | Borrower wallet parsed from the Horizon event data. |
| `data.creditLineId` | string | Credit line id parsed from the Horizon event data. |
| `data.horizonTimestamp` | string | Timestamp from the original Horizon event. |

Use `data.drawId` as the idempotency key. If the same draw id arrives again
after a successful delivery, return a 2xx response after confirming it is
already processed.

## Node.js Verification Example

This Express example keeps the raw body, verifies the HMAC in constant time,
rejects stale timestamps, and deduplicates by `data.drawId`.

```ts
import crypto from "node:crypto";
import express from "express";

const app = express();
const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  throw new Error("WEBHOOK_SECRET is required");
}
const processedDrawIds = new Set<string>();
const timestampToleranceMs = 5 * 60 * 1000;

app.post(
  "/creditra/webhook",
  express.raw({ type: "application/json", limit: "100kb" }),
  (req, res) => {
    const rawBody = req.body as Buffer;
    const signatureHeader = req.header("x-webhook-signature") ?? "";
    const timestampHeader = req.header("x-webhook-timestamp") ?? "";

    if (!signatureHeader.startsWith("sha256=")) {
      return res.status(401).json({ error: "missing signature" });
    }

    const expectedHex = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const providedHex = signatureHeader.slice("sha256=".length);

    const expected = Buffer.from(expectedHex, "hex");
    const provided = Buffer.from(providedHex, "hex");
    if (
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      return res.status(401).json({ error: "invalid signature" });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as {
      event: "draw_confirmed";
      timestamp: string;
      data: { drawId: string };
    };

    if (payload.timestamp !== timestampHeader) {
      return res.status(401).json({ error: "timestamp mismatch" });
    }

    const sentAt = Date.parse(payload.timestamp);
    if (
      !Number.isFinite(sentAt) ||
      Math.abs(Date.now() - sentAt) > timestampToleranceMs
    ) {
      return res.status(401).json({ error: "stale webhook" });
    }

    if (processedDrawIds.has(payload.data.drawId)) {
      return res.status(200).json({ duplicate: true });
    }

    processedDrawIds.add(payload.data.drawId);
    return res.status(200).json({ ok: true });
  },
);
```

## Operator Endpoints

The management routes are mounted under `/api/webhooks`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/webhooks/config` | Returns sanitized webhook configuration: URLs, retry knobs, timeout, and configured state. It never returns `WEBHOOK_SECRET`. |
| `POST` | `/api/webhooks/test` | Sends a connectivity probe to every configured URL and returns `{ total, reachable, unreachable, results }`. |
| `GET` | `/api/webhooks/health` | Returns `disabled` when no URLs are configured, otherwise `active` with URL count and retry settings. |

## Subscriber Checklist

- Verify `X-Webhook-Signature` over the raw request body before JSON parsing.
- Compare HMACs with `crypto.timingSafeEqual` or an equivalent constant-time primitive.
- Reject missing, malformed, mismatched, or stale `X-Webhook-Timestamp` values.
- After signature verification, require `X-Webhook-Timestamp` to match the signed payload `timestamp`.
- Process `draw_confirmed` payloads idempotently by `data.drawId`.
- Return a 2xx status only after the event is durably accepted or already known as a duplicate.
