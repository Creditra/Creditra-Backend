# Webhook Subscriber Guide

Creditra can fan out `draw_confirmed` events to subscriber URLs configured with `WEBHOOK_URLS`. The backend signs each outbound request with an HMAC-SHA256 signature generated from the exact JSON string sent on the wire.

Implementation references:

- [`src/services/drawWebhookService.ts`](../src/services/drawWebhookService.ts)
- [`src/routes/webhook.ts`](../src/routes/webhook.ts)

## Configuration

| Variable | Default | Description |
|---|---:|---|
| `WEBHOOK_URLS` | empty | Comma-separated subscriber URLs. Empty disables outbound delivery. |
| `WEBHOOK_SECRET` | empty | Shared HMAC secret. Required when `WEBHOOK_URLS` has at least one URL. |
| `WEBHOOK_MAX_RETRIES` | `3` | Number of retries after the first delivery attempt. |
| `WEBHOOK_INITIAL_BACKOFF_MS` | `1000` | Initial retry delay in milliseconds. |
| `WEBHOOK_BACKOFF_MULTIPLIER` | `2.0` | Multiplier applied after each retry delay. |
| `WEBHOOK_TIMEOUT_MS` | `10000` | Per-request timeout in milliseconds. |

The service attempts delivery once, then retries up to `WEBHOOK_MAX_RETRIES` additional times with exponential backoff.

## Request

Creditra sends a `POST` request to each configured subscriber URL.

```http
Content-Type: application/json
X-Webhook-Signature: sha256=<hex HMAC>
X-Webhook-Timestamp: <payload timestamp>
User-Agent: Creditra-Webhook/1.0
```

The signature is computed as:

```text
hex(hmac_sha256(WEBHOOK_SECRET, raw_json_body))
```

Verify the signature before parsing JSON. Any change to whitespace, key order, or encoding changes the HMAC input.

## Payload

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

Fields:

| Field | Type | Source |
|---|---|---|
| `event` | `"draw_confirmed"` | Fixed event type emitted by this service. |
| `timestamp` | ISO-8601 string | Time Creditra generated the webhook payload. |
| `data.ledger` | number | Horizon ledger number. |
| `data.contractId` | string | Contract ID from the Horizon event. |
| `data.drawAmount` | string | Draw amount parsed from the Horizon event JSON. Defaults to `"0"` if absent. |
| `data.drawId` | string | Stable draw identifier parsed from the Horizon event JSON. |
| `data.borrowerWallet` | string | Borrower wallet parsed from the Horizon event JSON. |
| `data.creditLineId` | string | Credit line identifier parsed from the Horizon event JSON. |
| `data.horizonTimestamp` | string | Timestamp on the original Horizon event. |

Use `data.drawId` as your idempotency key. If the same `drawId` arrives twice, return a 2xx response after confirming the first delivery was already processed.

## Node.js Verification

This Express example keeps the raw body for HMAC verification, compares signatures in constant time, rejects stale timestamps, and deduplicates on `data.drawId`.

```ts
import crypto from "node:crypto";
import express from "express";

const app = express();
const secret = process.env.WEBHOOK_SECRET ?? "";
const processedDrawIds = new Set<string>();
const toleranceMs = 5 * 60 * 1000;

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

    const sentAt = Date.parse(timestampHeader);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > toleranceMs) {
      return res.status(401).json({ error: "stale webhook" });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as {
      event: "draw_confirmed";
      data: { drawId: string };
    };

    if (processedDrawIds.has(payload.data.drawId)) {
      return res.status(200).json({ duplicate: true });
    }

    processedDrawIds.add(payload.data.drawId);
    return res.status(200).json({ ok: true });
  },
);
```

## Operator Endpoints

These endpoints are mounted under `/api/webhooks` and describe the server's outbound webhook fan-out.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/webhooks/config` | Returns sanitized webhook configuration: URLs, retry knobs, timeout, and configured state. It never returns `WEBHOOK_SECRET`. |
| `POST` | `/api/webhooks/test` | Sends a connectivity probe to each configured URL and returns `{ total, reachable, unreachable, results }`. |
| `GET` | `/api/webhooks/health` | Returns `disabled` when no URLs are configured, otherwise `active` with URL count and retry settings. |

## Subscriber Checklist

- Verify `X-Webhook-Signature` against the raw request body before JSON parsing.
- Compare HMACs with `crypto.timingSafeEqual` or an equivalent constant-time primitive.
- Reject missing, malformed, or stale `X-Webhook-Timestamp` values.
- Deduplicate successful processing by `data.drawId`.
- Return any 2xx status only after the event is durably accepted or already known as a duplicate.
