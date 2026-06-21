# Webhook Subscriber Onboarding

Creditra sends outbound webhooks when a draw is confirmed on chain. The
delivery path lives in
[`src/services/drawWebhookService.ts`](../src/services/drawWebhookService.ts),
and the operator-facing management endpoints live in
[`src/routes/webhook.ts`](../src/routes/webhook.ts).

This guide is for subscriber services that receive Creditra webhooks. It covers
the payload shape, headers, signature verification, timestamp tolerance, retry
behavior, and idempotency rules you should implement before enabling a
production subscriber URL.

## Event payload

The current webhook event is `draw_confirmed`. The service serializes the
payload with `JSON.stringify(payload)` and signs that raw JSON string.

```json
{
  "event": "draw_confirmed",
  "timestamp": "2026-06-22T00:00:00.000Z",
  "data": {
    "ledger": 123456,
    "contractId": "CBLZW7...",
    "drawAmount": "100.00",
    "drawId": "draw_123",
    "borrowerWallet": "GBORROWER...",
    "creditLineId": "credit_line_123",
    "horizonTimestamp": "2026-06-22T00:00:00.000Z"
  }
}
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `event` | string | Always `draw_confirmed` for this service. |
| `timestamp` | string | ISO-8601 timestamp generated when Creditra builds the webhook payload. |
| `data.ledger` | number | Horizon ledger number from the source event. |
| `data.contractId` | string | Contract ID from the Horizon event. |
| `data.drawAmount` | string | Draw amount parsed from the event data, or `"0"` when absent. |
| `data.drawId` | string | Stable draw identifier. Use this as the idempotency key. |
| `data.borrowerWallet` | string | Borrower wallet parsed from the event data. |
| `data.creditLineId` | string | Credit line identifier parsed from the event data. |
| `data.horizonTimestamp` | string | Timestamp from the Horizon event. |

## Delivery headers

Creditra sends webhook requests with these headers:

```http
Content-Type: application/json
X-Webhook-Signature: sha256=<hex HMAC>
X-Webhook-Timestamp: <ISO-8601 payload timestamp>
User-Agent: Creditra-Webhook/1.0
```

`X-Webhook-Signature` is the HMAC-SHA256 digest of the raw request body, signed
with the `WEBHOOK_SECRET` configured on the Creditra backend. The prefix is
always `sha256=`.

## Verification example

Verify the signature before parsing JSON. The HMAC input must be the raw request
body bytes as received by your HTTP framework.

```js
import crypto from "node:crypto";
import express from "express";

const app = express();
const webhookSecret = process.env.CREDITRA_WEBHOOK_SECRET;
const toleranceMs = 5 * 60 * 1000;

function verifyCreditraSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const receivedHex = signatureHeader.slice("sha256=".length);
  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  const received = Buffer.from(receivedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

app.post(
  "/webhooks/creditra",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.header("X-Webhook-Signature");
    const timestamp = req.header("X-Webhook-Timestamp");
    const rawBody = req.body.toString("utf8");

    if (!verifyCreditraSignature(rawBody, signature, webhookSecret)) {
      return res.status(401).json({ error: "invalid signature" });
    }

    const timestampMs = Date.parse(timestamp || "");
    if (!Number.isFinite(timestampMs)) {
      return res.status(400).json({ error: "invalid timestamp" });
    }

    if (Math.abs(Date.now() - timestampMs) > toleranceMs) {
      return res.status(400).json({ error: "stale webhook" });
    }

    const payload = JSON.parse(rawBody);

    // Store data.drawId in durable storage before doing side effects. If the
    // drawId was already processed, return 200 so Creditra does not retry.
    if (await alreadyProcessed(payload.data.drawId)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    await markProcessing(payload.data.drawId);
    await handleDrawConfirmed(payload);
    await markProcessed(payload.data.drawId);

    return res.status(200).json({ ok: true });
  }
);
```

## Timestamp tolerance

Reject missing, malformed, or stale `X-Webhook-Timestamp` values. A five-minute
window is a reasonable default for most subscriber services. Use the same
timestamp value for replay protection and incident logs.

The current Creditra implementation sets this header to the same ISO-8601 value
as `payload.timestamp`.

## Idempotency

Creditra retries failed deliveries, so subscriber handlers must be idempotent.
Use `data.drawId` as the durable idempotency key.

Recommended flow:

1. Verify the HMAC over the raw body.
2. Check timestamp freshness.
3. Parse JSON.
4. Check whether `data.drawId` was already processed.
5. Record the draw ID before side effects.
6. Return `2xx` for already-processed events.

## Retry and timeout knobs

Creditra operators configure outbound webhook delivery with these environment
variables:

| Variable | Default | Purpose |
|---|---:|---|
| `WEBHOOK_URLS` | empty | Comma-separated subscriber URLs. |
| `WEBHOOK_SECRET` | empty | HMAC secret. Required when `WEBHOOK_URLS` is configured. |
| `WEBHOOK_MAX_RETRIES` | `3` | Number of retries after the initial attempt. |
| `WEBHOOK_INITIAL_BACKOFF_MS` | `1000` | Initial retry delay in milliseconds. |
| `WEBHOOK_BACKOFF_MULTIPLIER` | `2.0` | Multiplier applied after each failed attempt. |
| `WEBHOOK_TIMEOUT_MS` | `10000` | Request timeout for normal delivery attempts. |

The connectivity test helper uses a fixed 5000 ms timeout for probe requests.

## Operator endpoints

These routes are mounted under `/api/webhooks` and describe Creditra's outbound
fan-out configuration. They do not receive subscriber webhooks.

### `GET /api/webhooks/config`

Returns sanitized configuration. The HMAC secret is never returned.

### `POST /api/webhooks/test`

Sends a connectivity probe to every configured subscriber URL and returns a
`{ total, reachable, unreachable, results[] }` summary.

### `GET /api/webhooks/health`

Returns `disabled` when no subscriber URLs are active and `active` when at
least one subscriber URL is configured.

## Subscriber checklist

- Keep `WEBHOOK_SECRET` out of source control and logs.
- Verify `X-Webhook-Signature` before parsing JSON.
- Reject stale or malformed `X-Webhook-Timestamp` values.
- Deduplicate on `data.drawId`.
- Return `2xx` for duplicates that were already processed successfully.
- Alert on repeated signature failures, timestamp failures, or delivery spikes.
