# Security Model

This document is the backend's threat model and the catalogue of in-tree mitigations. It complements the deploy-time checklists in [`docs/security-checklist-backend.md`](./security-checklist-backend.md) and [`docs/security-pentest-checklist.md`](./security-pentest-checklist.md), and the disclosure policy in the repo-root [`SECURITY.md`](../SECURITY.md).

---

## 1. Threat Model (at a glance)

| Asset | Threat | In-tree mitigation |
|---|---|---|
| Risk evaluations | Forgery / replay of risk inputs | Server-derived only — never trust client-supplied factors. `RiskEvaluationService` ignores anything but `walletAddress` + `forceRefresh`. |
| Credit-line state transitions | Unauthorised suspend/close | `X-Admin-Api-Key` gate with constant-time comparison ([`adminAuth.ts`](../src/middleware/adminAuth.ts)) + 503 fail-closed when key unset |
| Outbound webhooks | Spoofed delivery / replay | HMAC-SHA256 signature, `X-Webhook-Timestamp` freshness checks, `drawId` for dedup |
| API keys | Timing leaks during comparison | `crypto.timingSafeEqual` in [`auth.ts`](../src/middleware/auth.ts) |
| Logs | PII / secret exfiltration | `redactLogArgs`, Stellar public/secret/muxed account masking, email masking, and `sanitizeWallet` truncation |
| DB | Drift from on-chain truth | `ReconciliationWorker` runs every `RECONCILIATION_INTERVAL_MS` |
| Borrower PII (wallet address) | Indefinite retention of identifying data | `DataRetentionWorker` anonymizes inactive borrowers' `wallet_address` and purges stale audit/risk data — see [`docs/DATA_RETENTION.md`](./DATA_RETENTION.md) |
| Service availability | Brute force / abusive scrapers | Token-bucket rate limit with `Retry-After` |
| Service availability | Large body payloads | Per-endpoint body caps (default 100 KiB, bulk 1 MiB), early Content-Length reject, 413 problem+json — see [`docs/body-limits.md`](./body-limits.md) |
| Outbound calls | Slow / hung dependencies | `fetchWithTimeout` connect+read timeouts |

---

## 2. Authentication Model

### 2.1 API key (`X-API-Key`)

[`src/middleware/auth.ts`](../src/middleware/auth.ts) ships a factory:

```ts
createApiKeyMiddleware(validKeysOrResolver: Set<string> | () => Set<string>)
```

- Either a fixed set (tests) or a resolver invoked **per request** (production). The production wiring in [`src/routes/risk.ts`](../src/routes/risk.ts) and [`src/routes/reconciliation.ts`](../src/routes/reconciliation.ts) passes `() => loadApiKeys()`, so rotating `API_KEYS` in the secret store takes effect on the next request — no restart required.
- Comparison uses `crypto.timingSafeEqual` and the keys are encoded to bytes of identical length before comparison.
- The provided key value is **never** included in logs, error messages, or responses.
- Status semantics:
  - `401 Unauthorized` — header absent (caller is unaware of auth).
  - `403 Forbidden` — header present but invalid (caller is being told "your key is wrong" without disclosing which valid keys exist).

### 2.2 Admin key (`X-Admin-Api-Key`)

A separate, single-secret header in [`src/middleware/adminAuth.ts`](../src/middleware/adminAuth.ts). Distinct so the public API-key set can be granted to integration partners without unlocking destructive operations.

Fail-closed: when `ADMIN_API_KEY` is unset, the endpoint returns `503` so operators discover the misconfiguration rather than silently accepting any request.

### 2.3 Inbound webhooks (`X-Signature` / `X-Timestamp` / `X-Nonce`)

Partner ingress at `POST /api/inbound-webhooks/events` is authenticated with HMAC-SHA256 over `timestamp.nonce.raw_body`, not API keys. Middleware lives in [`src/middleware/inboundWebhookSignature.ts`](../src/middleware/inboundWebhookSignature.ts):

- Constant-time comparison via `crypto.timingSafeEqual`.
- Timestamp skew window (`INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS`, default 5 minutes).
- Nonce claim after successful verification blocks replay within the window.
- Fail-closed `503` when `INBOUND_WEBHOOK_SECRET` is unset.

Full partner scheme: [`docs/webhooks.md`](./webhooks.md).

### 2.4 Where session/JWT would live

No JWT or cookie auth ships today. If introduced, recommended placement:

- Issuance in a new `routes/auth.ts`.
- Verification in a new middleware sibling to `auth.ts`, sharing the envelope conventions and `timingSafeEqual` pattern.
- Refresh tokens stored hashed in a new table; never logged.

---

## 3. Role-Based Access Control

Two roles ship in code; everything else is read-public:

| Role | Header | Gated endpoints |
|---|---|---|
| `api-key` (partner / integration) | `X-API-Key` | `POST /api/risk/admin/recalibrate`, `/api/reconciliation/*` |
| `admin` (operator / support) | `X-Admin-Api-Key` | `POST /api/credit/lines/:id/suspend`, `.../close`, **`/api/support/*` (read-only)** |

Support tools (`/api/support/*`) are intentionally **GET-only** and fail closed when `ADMIN_API_KEY` is unset. Responses redact wallet addresses and strip secret-like fields — see [`src/utils/supportRedact.ts`](../src/utils/supportRedact.ts).

Both middlewares register **after** rate-limit but **before** the handler so an unauthenticated client can still be throttled. New roles should follow the same pattern.

---

## 4. Input Validation Policy

Every external boundary validates via Zod ([`src/schemas/`](../src/schemas/)). Middleware factories wrap the schemas — body, query, params, and optional response — from [`src/middleware/validate.ts`](../src/middleware/validate.ts):

```ts
validateBody(schema)       // replaces req.body with parsed value
validateQuery(schema)      // replaces req.query
validateParams(schema)     // replaces req.params
validateResponse(schema)   // opt-in response contract check (ENABLE_RESPONSE_VALIDATION)
```

Behaviour:

- On request failure → `400` with stable `{ data: null, error: "Validation failed", details: [{ field, message }] }`.
- On success → the parsed (and coerced) value **replaces** the raw input, so downstream handlers receive well-typed data.
- All credit/risk endpoints reject unknown keys via Zod `.strict()` (`additionalProperties: false` in OpenAPI).
- Stellar address validation lives in [`stellarAddress.ts`](../src/utils/stellarAddress.ts) (regex `/^G[A-Z2-7]{55}$/`) and is shared by `walletAddressSchema` and `walletAddressParamSchema`.
- Response validation (when enabled) never leaks Zod internals; clients see `{ data: null, error: "Response contract violation" }`.

Full policy, route coverage table, and test helpers: [`docs/json-schema-validation.md`](./json-schema-validation.md).

Validator chain order:

1. Security posture — `trust proxy` + Helmet headers ([`src/config/security.ts`](../src/config/security.ts), [`src/middleware/securityHeaders.ts`](../src/middleware/securityHeaders.ts))
2. CORS allowlist ([`src/config/cors.ts`](../src/config/cors.ts))
3. Content-Type guard (returns 415 if `POST/PUT/PATCH` has a body that isn't `application/json`)
4. JSON body parser (100 kB)
5. Request logger (assigns / propagates `x-request-id`)
6. Auth middleware (route-specific)
7. Rate limit middleware (route-specific)
8. Zod validate(Body|Query|Params)
9. Handler
10. `errorHandler` catches anything unhandled

---

## 5. HTTP security headers & proxy trust

Baseline posture is applied once at bootstrap via `applySecurityPosture(app)`:

| Control | Implementation | Notes |
|---|---|---|
| Trust proxy | `app.set('trust proxy', …)` from `TRUST_PROXY` | Required behind ALB/nginx/Cloudflare so `req.ip` and rate-limit keys see the real client. Default `false` (do not trust spoofed `X-Forwarded-For`). Accepts `true`/`false`, hop count (`1`), or Express presets (`loopback`, CIDR). |
| HSTS | Helmet `Strict-Transport-Security` | Default `max-age=15552000` (180d) + `includeSubDomains`. Override with `HSTS_MAX_AGE`; set `HSTS_PRELOAD=true` only after preload registration. |
| CSP | Helmet Content-Security-Policy | `default-src 'self'`, `frame-ancestors 'none'`, inline script/style allowed so `/docs` (Swagger UI) keeps working. COEP disabled for the same reason. |
| Clickjacking | `X-Frame-Options: DENY` | Also reinforced by CSP `frame-ancestors`. |
| MIME sniffing | `X-Content-Type-Options: nosniff` | Always on. |
| Referrer | `Referrer-Policy: no-referrer` | Avoids leaking path tokens. |
| Fingerprint | `X-Powered-By` removed | Helmet `hidePoweredBy`. |

### Secure cookies (future)

The API is header-auth only today (`X-API-Key` / `X-Admin-Api-Key`) and does **not** set cookies. If session or JWT cookies are introduced, use the defaults from `loadCookieDefaults()`:

- `httpOnly: true`
- `secure: true` in production (or when `COOKIE_SECURE=true`)
- `sameSite: 'lax'`
- `path: '/'`

### Production deploy checklist (proxy)

```env
# Behind one reverse-proxy hop (ALB / nginx):
TRUST_PROXY=1
# Optional HSTS tuning:
# HSTS_MAX_AGE=31536000
# HSTS_PRELOAD=true
```

Without `TRUST_PROXY`, clients can forge `X-Forwarded-For` and bypass IP-based rate limits. With it set too aggressively (e.g. `true` when no proxy is present), clients can still spoof the header — match the hop count to your real topology.

---

## 6. Rate Limiting Strategy

Implementation: [`src/middleware/rateLimit.ts`](../src/middleware/rateLimit.ts) — **token bucket** per key with continuous refill.

### Algorithm

Each key owns a bucket of `maxRequests` tokens. Tokens refill continuously at
`maxRequests / windowMs` tokens per millisecond. Every request costs one token.
When the bucket is empty the middleware returns `429`.

Per-route defaults (wired in [`src/index.ts`](../src/index.ts)):

| Route group | Capacity env | Default |
|---|---|---|
| `/api/credit/*`, `/api/risk/wallet/*` | `RATE_LIMIT_MAX_REQUESTS` | 100 / 60s |
| `POST /api/risk/evaluate` | `RATE_LIMIT_MAX_EVALUATE` | 10 / 60s |

### Knobs

```env
RATE_LIMIT_WINDOW_MS=60000         # refill window (capacity fully refills over this period)
RATE_LIMIT_MAX_REQUESTS=100        # generic per-route bucket capacity
RATE_LIMIT_MAX_EVALUATE=10         # per-route override for /api/risk/evaluate
RATE_LIMIT_REDIS_URL=redis://...   # optional shared store for scaled replicas
RATE_LIMIT_REDIS_FAILURE_MODE=open # open | closed, default open
ADMIN_API_KEY=...                  # enables admin/service rate-limit bypass
```

### Key generators (proxy-safe)

- `createIpKeyGenerator()` — prefers Express `req.ip` when `trust proxy` is set
  (so only the configured reverse-proxy hop count is trusted); otherwise uses the
  first `X-Forwarded-For` hop, then `req.ip`, then `"unknown"`.
- `createApiKeyKeyGenerator()` — keys by API key when supplied, otherwise IP.

Production deployments behind a load balancer **should** set
`app.set('trust proxy', 1)` (or an equivalent hop count) so client IPs come from
the edge proxy rather than a client-spoofable header.

### Admin / service bypass

`createAdminBypassChecker()` skips the token charge when the request presents a
valid `X-Admin-Api-Key` matching `ADMIN_API_KEY` (timing-safe compare). Bypass is
**fail-closed**: if `ADMIN_API_KEY` is unset, no request is exempt.

Bypassed responses still emit rate-limit headers and set:

```
X-RateLimit-Bypass: admin
```

This is intended for trusted operators and internal service accounts, not end users.

### Headers on every limited response

```
X-RateLimit-Limit: <capacity>
X-RateLimit-Remaining: <whole tokens left>
X-RateLimit-Reset: <epoch seconds when bucket is next full>
X-RateLimit-Bypass: admin          # only when bypass applied
Retry-After: <seconds>             # only on 429
```

429 body envelope:

```json
{ "data": null, "error": "Too many requests. Please retry after N seconds.", "retryAfter": N }
```

### Storage

By default limits are in-process (`InMemoryRateLimitStore`), so each API replica
has its own counters. Set `RATE_LIMIT_REDIS_URL` to use the Redis-backed store for
shared per-key counters across replicas. The middleware still uses the same key
generators and `RateLimitOptions`; the Redis store namespaces each route bucket
and hashes the generated key before writing it to Redis so API keys are not
stored in clear text as Redis keys.

Redis consume uses a single Lua script that refills the bucket, deducts a token
when available, and returns `{ allowed, remaining, resetAt }`. Connect and
consume operations are bounded so a stalled Redis dependency reaches the
configured outage policy instead of hanging requests. If Redis is unavailable,
the default `RATE_LIMIT_REDIS_FAILURE_MODE=open` fails open: requests continue
with rate-limit headers instead of turning dependency failures into 500s.
Operators that prefer availability protection over dependency tolerance can set
`RATE_LIMIT_REDIS_FAILURE_MODE=closed`, which returns the normal 429 envelope
while Redis is unavailable. Redis store failures are logged with a per-bucket
throttle and without the Redis URL or generated request key.

---

## 7. Idempotency

Three independent layers:

| Layer | Mechanism | File |
|---|---|---|
| Inbound writes | `events.idempotency_key` partial-unique index | `migrations/001_initial_schema.sql` |
| Indexer | `eventId = SHA256(ledger || contractId || topics || data)` + 10 000-entry LRU set | [`horizonListener.ts`](../src/services/horizonListener.ts) |
| Outbound webhooks | Stable `drawId` in payload + retry-aware subscribers | [`drawWebhookService.ts`](../src/services/drawWebhookService.ts) |

---

## 8. Webhook Signature Verification

The backend ships **outbound** webhooks (no inbound webhook surface today). Each delivery includes:

```http
X-Webhook-Signature: sha256=<hex HMAC over raw body>
X-Webhook-Timestamp: <payload ISO timestamp>
User-Agent: Creditra-Webhook/1.0
```

Producer:

- Secret loaded from `WEBHOOK_SECRET` — refuses to start (`getWebhookConfig()` returns `null`) when URLs are configured without a secret.
- HMAC computed over the **raw JSON body** prior to send; subscribers should validate against the body bytes they received, not a re-serialized form.
- Delivery settings expose `WEBHOOK_MAX_RETRIES`, `WEBHOOK_INITIAL_BACKOFF_MS`, and `WEBHOOK_BACKOFF_MULTIPLIER`.

Subscriber expectation (documented in [`webhook-subscribers.md`](./webhook-subscribers.md)):

1. Recompute `HMAC-SHA256(body, secret)` and compare in constant time.
2. Reject deliveries older than your tolerance window (`X-Webhook-Timestamp`).
3. Deduplicate by `data.drawId`.

---

## 9. Secret Management

- **Sources.** All secrets enter through environment variables — see [`.env.example`](../.env.example) for the canonical list. The container loaders in [`src/config/`](../src/config/) are the only code paths that read them.
- **Validation.** `validateEnv()` in [`src/config/env.ts`](../src/config/env.ts) asserts presence of `DATABASE_URL` and `API_KEYS` at boot and refuses to start otherwise. Production additionally requires `CORS_ORIGINS` ([`src/config/cors.ts`](../src/config/cors.ts)).
- **Rotation.** `loadApiKeys()` is invoked per-request via a resolver closure so partner keys can be rotated by updating the env source (e.g. Kubernetes Secret + restart-free reload) without redeploying.
- **Out of logs.** The Pino-based [`logger`](../src/utils/logger.ts) is paired with [`logRedact.ts`](../src/utils/logRedact.ts) which:
  - Redacts Stellar pubkeys (`G[A-Z2-7]{55}`) to `Gxxxxx...xxxx` form.
  - Masks Stellar secret seeds, muxed accounts, and email addresses.
  - Walks nested objects and `Error.message`.
  - Is opt-out via `LOG_REDACTION_DEBUG` for incident response.
- **Sanitized errors.** [`sanitizeStellarDiagnostic`](../src/services/stellarDiagnostics.ts) strips Stellar keys from Soroban diagnostics before propagation.
- **No `.env` in image.** `Dockerfile` deliberately omits the env file; secrets must be injected at runtime.

---

## 10. Audit Logging

- **Request lifecycle.** [`requestLogger.ts`](../src/middleware/requestLogger.ts) logs `request:start` and `request:end` with `{ requestId, method, path, statusCode, durationMs, walletAddress (sanitized) }`. The same `requestId` is propagated to the response via `x-request-id`.
- **Domain events.** Persisted to the `events` table with `event_type`, `aggregate_type/id`, JSONB `payload`, `idempotency_key` for replay safety, and `created_at`. Indexed on `(aggregate_type, aggregate_id)` and `created_at` for time-range queries.
- **Reconciliation.** Each reconciliation pass emits a `ReconciliationResult` containing per-line `mismatches[]` (with severity) and `errors[]`. Critical mismatches cause the worker to throw, retrying via the job queue and surfacing to monitoring.
- **Listener.** `HorizonListener.getMetrics()` exposes counters useful for SIEM ingestion: `failedPolls`, `rateLimitHits`, `cursorGapsDetected`, etc.

---

## 11. Defence-in-Depth Quick Reference

| Concern | Where to look |
|---|---|
| CSRF | Not applicable — no cookie/session auth; explicit `X-API-Key` header foils CSRF |
| Open redirect | No redirect endpoints — `swagger-ui-express` serves static |
| XSS | API returns JSON only; never renders user content |
| SQL injection | All queries via parameterized `pg.Client.query(text, values)` |
| SSRF | Outbound URLs are constrained: Horizon, Soroban, configured webhook URLs only; all guarded by `fetchWithTimeout` |
| Dependency tampering | Lockfile committed; CI runs `npm audit --audit-level=moderate` ([`.github/workflows/backend-ci.yml`](../.github/workflows/backend-ci.yml)); Dependency Review on PRs |
| Container hardening | `Dockerfile` runs as non-root `node` user, multi-stage build, Alpine runtime |
| Slowloris / connection abuse | Reverse proxy (deployment concern); we time-bound outbound, not inbound — pair with nginx/envoy timeouts |
| Shutdown DoS | `SHUTDOWN_TIMEOUT_MS` ceiling prevents stuck shutdowns blocking orchestrator restarts |
| Clickjacking / MIME sniff / HSTS | Helmet baseline in `applySecurityPosture` (§5); set `TRUST_PROXY` behind reverse proxies |

---

## 12. Reporting a vulnerability

See the repo-root [`SECURITY.md`](../SECURITY.md). In short: **do not** open a public issue; email the security alias. Include reproduction steps, observed vs expected behavior, and the affected commit SHA. We commit to acknowledging within 72 hours.

---

## 13. References

- [`SECURITY.md`](../SECURITY.md) — disclosure policy
- [`docs/security-checklist-backend.md`](./security-checklist-backend.md) — pre-deploy checklist
- [`docs/security-pentest-checklist.md`](./security-pentest-checklist.md) — pentest scope guide
- [`docs/http-timeouts.md`](./http-timeouts.md) — outbound HTTP timeout policy
