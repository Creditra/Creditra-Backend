# Webhook Subscriber Onboarding Guide

Creditra sends outbound `draw_confirmed` webhooks when the Horizon listener sees an on-chain draw confirmation. This guide shows how to configure a subscriber endpoint, verify Creditra's HMAC signature, reject replayed deliveries, and process retries idempotently.

The producer implementation lives in [`src/services/drawWebhookService.ts`](../src/services/drawWebhookService.ts). The API reference for webhook management endpoints is in [`docs/API.md`](./API.md#webhooks).

## Delivery Contract

Creditra sends a `POST` request to each URL in `WEBHOOK_URLS` with these headers:

```http
Content-Type: application/json
X-Webhook-Signature: sha256=<hex HMAC over raw body>
X-Webhook-Timestamp: <ms epoch>
User-Agent: Creditra-Webhook/1.0
```

The payload currently has one event type:

```json
{
  "event": "draw_confirmed",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "data": {
    "ledger": 123456,
    "contractId": "C...",
    "drawAmount": "100.00",
    "drawId": "draw_...",
    "borrowerWallet": "G...",
    "creditLineId": "cl_...",
    "horizonTimestamp": "2024-01-01T00:00:00Z"
  }
}
```

`X-Webhook-Signature` is `HMAC-SHA256(rawBody, WEBHOOK_SECRET)`, encoded as lowercase hex and prefixed with `sha256=`.

## Subscriber Checklist

1. Read the raw request body before JSON parsing.
2. Recompute `HMAC-SHA256` with the same shared secret configured in Creditra's `WEBHOOK_SECRET`.
3. Compare the received and expected signatures in constant time.
4. Reject stale timestamps, usually older than 5 minutes.
5. Deduplicate by `data.drawId` before doing side effects.
6. Return any `2xx` status only after the event is safely accepted or already processed.

Creditra retries failed deliveries with exponential backoff. A retried delivery may contain the same `drawId`, so subscribers must make processing idempotent.

## Configure Creditra

```bash
WEBHOOK_URLS=https://subscriber.example.com/creditra/webhooks
WEBHOOK_SECRET=replace-with-a-random-32-byte-or-longer-secret
WEBHOOK_MAX_RETRIES=3
WEBHOOK_INITIAL_BACKOFF_MS=1000
WEBHOOK_BACKOFF_MULTIPLIER=2
WEBHOOK_TIMEOUT_MS=10000
```

Use comma-separated URLs to fan out to multiple subscribers:

```bash
WEBHOOK_URLS=https://a.example.com/creditra,https://b.example.com/creditra
```

The webhook configuration endpoint returns URLs and retry settings but never returns the secret:

```bash
curl http://localhost:3000/api/webhooks/config
```

To send the built-in test payload to every configured URL:

```bash
curl -X POST http://localhost:3000/api/webhooks/test
```

## Express Subscriber Example

This example keeps the raw body available with `express.raw`, verifies the HMAC, enforces a 5-minute replay window, and deduplicates by `drawId`.

```ts
import crypto from "node:crypto";
import express from "express";

const app = express();
const webhookSecret = process.env.CREDITRA_WEBHOOK_SECRET ?? "";
const processedDrawIds = new Set<string>();
const toleranceMs = 5 * 60 * 1000;

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

app.post(
  "/creditra/webhooks",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.header("X-Webhook-Signature") ?? "";
    const timestamp = req.header("X-Webhook-Timestamp") ?? "";
    const rawBody = req.body as Buffer;

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > toleranceMs) {
      return res.status(400).json({ error: "stale_webhook_timestamp" });
    }

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    if (!timingSafeEqualString(signature, expected)) {
      return res.status(401).json({ error: "invalid_webhook_signature" });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as {
      event: "draw_confirmed";
      data: { drawId: string };
    };

    if (payload.event !== "draw_confirmed") {
      return res.status(400).json({ error: "unsupported_event" });
    }

    if (processedDrawIds.has(payload.data.drawId)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    processedDrawIds.add(payload.data.drawId);

    // Persist the draw confirmation and trigger downstream work here.
    return res.status(200).json({ ok: true });
  }
);

app.listen(8080);
```

For production, store processed `drawId` values in durable storage with a unique constraint instead of an in-memory `Set`.

## Next.js Route Handler Example

```ts
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const webhookSecret = process.env.CREDITRA_WEBHOOK_SECRET ?? "";
const toleranceMs = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-webhook-signature") ?? "";
  const timestamp = request.headers.get("x-webhook-timestamp") ?? "";

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > toleranceMs) {
    return NextResponse.json({ error: "stale_webhook_timestamp" }, { status: 400 });
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const valid =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!valid) {
    return NextResponse.json({ error: "invalid_webhook_signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody.toString("utf8"));

  // Upsert by payload.data.drawId before running side effects.
  return NextResponse.json({ ok: true });
}
```

## Testing A Subscriber Locally

Generate a signed test request with the same algorithm Creditra uses:

```bash
export CREDITRA_WEBHOOK_SECRET="local-secret"
export BODY='{"event":"draw_confirmed","timestamp":"2024-01-01T00:00:00.000Z","data":{"ledger":123456,"contractId":"C...","drawAmount":"100.00","drawId":"draw_local_test","borrowerWallet":"G...","creditLineId":"cl_local_test","horizonTimestamp":"2024-01-01T00:00:00Z"}}'
export TS="$(node -e 'process.stdout.write(String(Date.now()))')"
export SIG="$(node -e 'const crypto=require("crypto"); process.stdout.write("sha256="+crypto.createHmac("sha256", process.env.CREDITRA_WEBHOOK_SECRET).update(process.env.BODY, "utf8").digest("hex"))')"

curl -i \
  -X POST http://localhost:8080/creditra/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Timestamp: $TS" \
  -H "X-Webhook-Signature: $SIG" \
  --data "$BODY"
```

To confirm failure handling, change one character in `SIG` or send an old timestamp. Your endpoint should reject the delivery before processing side effects.

## Common Failure Modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `invalid_webhook_signature` | The subscriber verifies a re-serialized JSON object instead of the raw body bytes. | Capture the raw request body and sign those exact bytes. |
| `stale_webhook_timestamp` | Clock skew or a replayed delivery outside your tolerance window. | Check host clock sync and choose an explicit tolerance. |
| Duplicate downstream actions | Retries processed the same draw more than once. | Store `data.drawId` with a unique constraint and treat conflicts as success. |
| Creditra config startup failure | `WEBHOOK_URLS` is set without `WEBHOOK_SECRET`. | Configure both env vars or remove `WEBHOOK_URLS` to disable fan-out. |

## Security Notes

- Use a high-entropy secret and rotate it through your normal secret-management process.
- Serve subscriber endpoints over HTTPS in non-local environments.
- Keep the timestamp window short enough to reduce replay risk, but long enough for normal network delay.
- Do not log `WEBHOOK_SECRET`, full signatures, or borrower identifiers in plaintext.
