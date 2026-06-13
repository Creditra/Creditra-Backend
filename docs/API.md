# API Reference

Human-readable companion to the machine-readable spec at [`src/openapi.yaml`](../src/openapi.yaml) (served live at `/docs` and `/docs.json`). When in doubt, the YAML is authoritative.

- **Base URL (dev):** `http://localhost:3000`
- **Default media type:** `application/json` (the server returns `415` if you `POST/PUT/PATCH` anything else)
- **Response envelope:** `{ "data": <payload> | null, "error": <string> | null }`
- **Body limit:** 100 kB (oversize returns `413`)

---

## 1. Authentication

Two perpendicular headers:

| Header | Used by | Backed by |
|---|---|---|
| `X-API-Key` | Risk admin, reconciliation admin | [`src/middleware/auth.ts`](../src/middleware/auth.ts) |
| `X-Admin-Api-Key` | Credit-line `suspend` / `close` | [`src/middleware/adminAuth.ts`](../src/middleware/adminAuth.ts) |

- API keys are compared in constant time via `crypto.timingSafeEqual`.
- Missing → `401`, present-but-wrong → `403`.
- Admin endpoint with no `ADMIN_API_KEY` configured → `503` (fail closed).

Read endpoints are public-by-design but rate-limited.

---

## 2. Error envelope

Every error response (`4xx`, `5xx`) has this shape:

```json
{
  "data": null,
  "error": "<human readable summary>"
}
```

Validation errors additionally include `details`:

```json
{
  "data": null,
  "error": "Validation failed",
  "details": [
    { "field": "walletAddress", "message": "Invalid Stellar address" }
  ]
}
```

Rate-limit responses additionally include `retryAfter` and the `Retry-After` HTTP header. See [`docs/error-envelope.md`](./error-envelope.md) for the helper API.

### Status code semantics

| Code | When |
|---|---|
| 200 | Successful read or non-creation action |
| 201 | Resource created |
| 202 | Asynchronous accept (e.g. reconciliation trigger) |
| 204 | Successful delete |
| 400 | Schema validation failed |
| 401 | Auth header missing |
| 403 | Auth header present but invalid |
| 404 | Resource not found |
| 409 | Invalid state transition (e.g. close-of-closed) |
| 413 | Body > 100 kB |
| 415 | Mutating request lacked `application/json` |
| 429 | Rate limit exhausted |
| 500 | Internal error (no stack leaked) |
| 503 | Service unconfigured (e.g. admin key missing) |

---

## 3. Pagination & filtering conventions

Two pagination styles ship — pick the one the endpoint advertises in its query schema.

### Offset/limit (default for risk history, transactions)

| Param | Type | Default | Bounds |
|---|---|---|---|
| `offset` | int | 0 | ≥ 0 |
| `limit` | int | 20 | 1–100 |
| `page` *(transactions only)* | int | 1 | ≥ 1 |

### Cursor (credit-line list)

`CreditLineService.getAllCreditLinesWithCursor(cursor?, limit?)` returns `{ items, nextCursor }`. Cursor is an opaque string; clients should pass it back verbatim. See [`docs/cursor-pagination.md`](./cursor-pagination.md).

### Filtering — transactions

`GET /api/credit/lines/:id/transactions` accepts:

- `type` ∈ `borrow | repay | interest_accrual | fee | status_change`
- `from`, `to` — ISO-8601 date strings (`new Date(from).getTime()` must be valid)
- `page`, `limit`

---

## 4. Endpoint inventory

### Health

#### `GET /health`

Liveness + dependency probe.

- **Auth:** none
- **Response 200:**
  ```json
  {
    "data": {
      "status": "ok",
      "service": "creditra-backend",
      "ready": true,
      "dependencies": {
        "database": { "status": "ok" },
        "horizon":  { "status": "ok" }
      }
    },
    "error": null
  }
  ```
- **Dependency states:** `ok | unconfigured | degraded`. Both DB and Horizon are probed with their own timeouts (1 s and 2 s respectively).

Webhook health: `GET /api/webhooks/health`.

---

### Credit Lines

Implemented in [`src/routes/credit.ts`](../src/routes/credit.ts), backed by `CreditLineService` and the in-memory `creditService` helpers.

#### `GET /api/credit/lines`

List all credit lines (in-memory store list).

- **Auth:** none
- **Response 200:** `{ data: CreditLine[], error: null }`

#### `GET /api/credit/lines/:id`

- **404:** `Credit line "<id>" not found.`

#### `POST /api/credit/lines`

- **Body** (validated by `createCreditLineSchema`):
  ```json
  {
    "walletAddress": "GDRXE2BQUC...",
    "requestedLimit": "1000.00",
    "interestRateBps": 640
  }
  ```
- **Validation:** wallet must satisfy `^G[A-Z2-7]{55}$`. Either `creditLimit` or `requestedLimit` is required.
- **Response 201:** newly created `CreditLine`.
- **Errors:** `400` on validation, `400` on domain error message.

#### `PUT /api/credit/lines/:id`

Patches `creditLimit`, `interestRateBps`, or `status`.

- **404:** Credit line not found.

#### `DELETE /api/credit/lines/:id`

- **Response 204:** No body.

#### `GET /api/credit/wallet/:walletAddress/lines`

- **Validation:** Stellar address.
- **Response 200:** `{ creditLines: CreditLine[] }`

#### `GET /api/credit/lines/:id/transactions`

Filterable transaction history.

- **Query:** `type`, `from`, `to`, `page`, `limit` (see §3).
- **Errors:** `400` for any bad filter; `404` if line not found.

#### `POST /api/credit/lines/:id/draw`

- **Body** (`drawSchema`): `{ walletAddress, amount }` — `amount` is a decimal string.
- **Response 200:** draw result (status `pending` until Horizon confirms).

#### `POST /api/credit/lines/:id/repay`

- **Body** (`repaySchema`): `{ walletAddress, amount }`.
- **Response 200:** repay result.

#### `POST /api/credit/lines/:id/suspend` *(admin)*

- **Auth:** `X-Admin-Api-Key`.
- **Response 200:** `{ data: CreditLine, message: 'Credit line suspended.', error: null }`
- **409:** Invalid status transition.

#### `POST /api/credit/lines/:id/close` *(admin)*

- Same envelope as `suspend`.

---

### Risk

Implemented in [`src/routes/risk.ts`](../src/routes/risk.ts), backed by `RiskEvaluationService` and the pluggable provider factory.

#### `POST /api/risk/evaluate`

- **Body** (`riskEvaluateSchema`):
  ```json
  { "walletAddress": "G...", "forceRefresh": false }
  ```
- **Behavior:** returns the cached evaluation when fresh (< 24 h). `forceRefresh: true` forces a re-evaluation.
- **Response 200:** `RiskEvaluation` (id, walletAddress, riskScore 0–100, creditLimit, interestRateBps, factors[], evaluatedAt, expiresAt).

#### `GET /api/risk/evaluations/:id`

- **404:** `Risk evaluation not found`.

#### `GET /api/risk/wallet/:walletAddress/latest`

- **404:** `No risk evaluation found for wallet`.

#### `GET /api/risk/wallet/:walletAddress/history`

- **Query:** `offset`, `limit` (validated by `riskHistoryQuerySchema`).
- **Response 200:** `{ data: { evaluations: RiskEvaluation[] }, error: null }`.

#### `POST /api/risk/admin/recalibrate` *(API-key auth)*

Hook for triggering a recalibration of the risk model.

- **Auth:** `X-API-Key`.

---

### Webhooks

Implemented in [`src/routes/webhook.ts`](../src/routes/webhook.ts). These describe the **server's outbound webhook fan-out**, not inbound webhooks.

#### `GET /api/webhooks/config`

Returns subscriber URLs, retry/backoff settings, and timeout — never the secret.

#### `POST /api/webhooks/test`

Reachability probe for every configured URL. Returns `{ total, reachable, unreachable, results[] }`.

#### `GET /api/webhooks/health`

`active | disabled` — disabled when no URLs are configured.

#### Outbound payload contract (subscriber side)

`POST <subscriber URL>` with:

```http
Content-Type: application/json
X-Webhook-Signature: sha256=<hex HMAC>
X-Webhook-Timestamp: <epoch ms>
User-Agent: Creditra-Webhook/1.0
```

```json
{
  "event": "draw_confirmed",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "data": {
    "ledger": 123456,
    "contractId": "C…",
    "drawAmount": "100.00",
    "drawId": "draw_…",
    "borrowerWallet": "G…",
    "creditLineId": "cl_…",
    "horizonTimestamp": "2024-01-01T00:00:00Z"
  }
}
```

HMAC is computed over the **raw JSON body** with `WEBHOOK_SECRET`. Subscribers must:

1. Re-compute `HMAC-SHA256(body, secret)` and compare in constant time.
2. Reject when `now - X-Webhook-Timestamp` exceeds your tolerance window.
3. Deduplicate by `data.drawId`.

Server retries up to `WEBHOOK_MAX_RETRIES + 1` times with exponential backoff — implement idempotency on receive.

---

### Reconciliation

Implemented in [`src/routes/reconciliation.ts`](../src/routes/reconciliation.ts), all admin-gated.

#### `POST /api/reconciliation/trigger`

- **Auth:** `X-API-Key`.
- **Response 202:** `{ data: { jobId, message }, error: null }`.

#### `GET /api/reconciliation/status`

- **Auth:** `X-API-Key`.
- **Response 200:** `{ data: { workerRunning, queueSize, failedJobs }, error: null }`.

---

## 5. Rate-limit headers (every response)

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1718243400      # epoch seconds
Retry-After: 12                    # only on 429
```

Defaults: `RATE_LIMIT_WINDOW_MS=60000`, `RATE_LIMIT_MAX_REQUESTS=100`, `RATE_LIMIT_MAX_EVALUATE=10` (the risk endpoint is more expensive).

---

## 6. Idempotency

- **Inbound writes**: the `events` table enforces a partial-unique index on `idempotency_key`. Client-supplied keys can be wired into command handlers when needed.
- **Outbound webhooks**: every event carries a stable `drawId` derived from on-chain identifiers.
- **Indexer**: SHA-256 over `ledger || contractId || topics || data` produces an `eventId` deduplicated across polls via a 10 000-entry LRU set.

---

## 7. Generated client tips

- The `operationId` field in `openapi.yaml` is stable — use it as the function name for any generator.
- `npm run validate:spec` parses the YAML in CI to catch structural drift early.
- Tags are: `Health`, `Credit`, `Risk`, `Webhooks` — useful for grouping in SDK output.
