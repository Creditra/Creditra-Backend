# API Response Envelope & Problem+JSON Taxonomy

The Creditra Backend wraps successful JSON responses in a consistent envelope
and standardises error responses as **RFC 7807** `application/problem+json`
with a documented taxonomy so clients can branch on stable `type` and `code`.

```jsonc
// Success
{ "data": { "id": "...", "amount": "100.00" }, "error": null }

// Failure (legacy envelope still present on problem+json bodies)
{
  "type": "https://docs.creditra.dev/problems/validation_failed",
  "title": "Validation Error",
  "status": 400,
  "detail": "Validation failed",
  "code": "validation_failed",
  "details": [{ "field": "amount", "message": "Must be positive" }],
  "data": null,
  "error": "Validation failed"
}
```

## Rules

- Success responses use `{ data, error: null }` via `ok()` from
  `src/utils/response.ts`.
- Error responses use **`Content-Type: application/problem+json`** with the
  fields below. Legacy `data: null` and `error` (same text as `detail`) are
  included so older clients keep working.
- Exactly one of success `data` / error `detail` is meaningful for a response.
- For unexpected `5xx` responses, `detail` / `error` are generic
  (`Internal server error`). Stack traces, SQL errors, wallet addresses,
  secrets, and raw upstream payloads are **never** included in the body.
- Clients should treat `code` (and optionally `type`) as the stable contract;
  free-text `detail` may be refined without notice.

## Problem+JSON fields

| Field | Purpose |
|---|---|
| `type` | URI: `https://docs.creditra.dev/problems/{code}` |
| `title` | Short summary for the code category (fixed) |
| `status` | HTTP status code |
| `detail` | Occurrence-specific human explanation |
| `code` | Stable machine code (taxonomy) |
| `details` | Optional non-sensitive context (field issues or object) |
| `resource` | Optional resource kind (`credit_line`, …) |
| `retryAfter` | Optional seconds (rate limit); also `Retry-After` header |
| `error` / `data` | Legacy envelope fields for older clients |

## Error taxonomy

| Category | HTTP | `code` | Typical source |
|---|---|---|---|
| Validation | 400 | `validation_failed` | Zod `validateBody` / `validateQuery` / `validateParams` |
| Auth (missing) | 401 | `unauthorized` | `auth`, `adminAuth` |
| Auth (invalid) | 403 | `forbidden` | `auth` |
| Not found | 404 | `not_found` | Missing credit line / API key |
| Conflict | 409 | `duplicate_resource` | Duplicate resource create |
| Conflict | 409 | `version_conflict` | Optimistic lock failure |
| Conflict | 409 | `invalid_state_transition` | Illegal credit-line state change |
| Conflict | 409 | `unique_constraint_violation` | Postgres unique violation (when wired) |
| Payload | 413 | `payload_too_large` | Body > limit |
| Media type | 415 | `unsupported_media_type` | Non-JSON mutating body |
| Rate limited | 429 | `rate_limited` | Rate-limit middleware |
| Upstream | 502 | `upstream_failure` | Horizon / external HTTP failure |
| Upstream | 504 | `upstream_timeout` | Outbound timeout |
| Unavailable | 503 | `service_unavailable` | Maintenance mode / misconfig |
| Internal | 500 | `internal_error` | Unhandled exceptions |

### Conflict example (HTTP 409)

```jsonc
{
  "type": "https://docs.creditra.dev/problems/duplicate_resource",
  "title": "Conflict",
  "status": 409,
  "detail": "An open credit line already exists for this wallet. Close it before opening another.",
  "code": "duplicate_resource",
  "resource": "credit_line",
  "details": { "field": "walletAddress", "existingStatus": "active" },
  "data": null,
  "error": "An open credit line already exists for this wallet. Close it before opening another."
}
```

**Security:** wallet addresses, secrets, API keys, and raw Postgres constraint
details (which can embed key values) must never appear in `detail` or `details`.

### Rate limit example (HTTP 429)

```jsonc
{
  "type": "https://docs.creditra.dev/problems/rate_limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Too many requests. Please retry after 12 seconds.",
  "code": "rate_limited",
  "retryAfter": 12,
  "data": null,
  "error": "Too many requests. Please retry after 12 seconds."
}
```

Also sets `Retry-After` and the standard `X-RateLimit-*` headers.

## Central translator

`src/middleware/errorHandler.ts` is the central translator:

1. Maps `AppError` / `ConflictError` → problem+json via `sendProblem`.
2. Maps well-known `Error.name` values (`ValidationError`, `NotFoundError`,
   `VersionConflictError`, `HttpTimeoutError`, …) to taxonomy codes.
3. Maps body-parser `entity.too.large` → `payload_too_large`.
4. Everything else → `internal_error` with a generic detail.

Typed factories live in `src/errors/` (`validationFailed`, `unauthorized`,
`notFound`, `rateLimited`, `upstreamFailure`, `ConflictError`, …).

## Conflict responses (HTTP 409)

Duplicate resources and state conflicts use **RFC 7807**
`application/problem+json` via the shared `ConflictError` type
(`src/errors/ConflictError.ts`). Content-Type is `application/problem+json`.

```jsonc
{
  "type": "https://docs.creditra.dev/problems/duplicate_resource",
  "title": "Conflict",
  "status": 409,
  "detail": "An open credit line already exists for this wallet. Close it before opening another.",
  "code": "duplicate_resource",
  "resource": "credit_line",
  "details": { "field": "walletAddress", "existingStatus": "active" },
  "data": null,
  "error": "An open credit line already exists for this wallet. Close it before opening another."
}
```

| Field | Purpose |
|---|---|
| `code` | Stable machine code: `duplicate_resource`, `version_conflict`, `invalid_state_transition`, `unique_constraint_violation` |
| `resource` | Optional kind: `credit_line`, `risk_evaluation`, `webhook_subscription`, … |
| `details` | Actionable **non-sensitive** context only (field names, status enums) |
| `error` / `data` | Legacy envelope fields for older clients |

**Security:** wallet addresses, secrets, API keys, and raw Postgres constraint
details (which can embed key values) are never included in `detail` or
`details`.

Postgres unique violations (`SQLSTATE 23505`) are translated by
`conflictFromUniqueViolation` into the same shape.

## Helpers

| Helper | Use for |
|---|---|
| `ok(res, payload, status?)` | Success envelope |
| `fail(res, error, status?)` | Legacy envelope only (prefer problem helpers) |
| `sendProblem(res, err \| source)` | Any taxonomy problem+json |
| `sendConflict(res, ConflictError)` | 409 convenience alias |

Prefer throwing `AppError` / `ConflictError` (or calling `sendProblem`) over
building error JSON inline.
