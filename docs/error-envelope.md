# API Response Envelope

The Creditra Backend wraps every JSON response in a consistent envelope so
that clients can branch on the presence of an `error` field without having
to know endpoint-specific shapes.

```jsonc
// Success
{ "data": { "id": "...", "amount": "100.00" }, "error": null }

// Failure
{ "data": null, "error": "Validation failed: amount must be positive" }
```

## Rules

- Exactly one of `data` / `error` is non-null at any time.
- `error` is always a human-readable string. Structured error details
  (codes, fields) are intentionally omitted from this generic envelope;
  endpoint-specific error structures, where they exist, live inside
  `data` on `4xx` responses.
- For `5xx` responses, the envelope deliberately hides internal error
  messages. Clients should treat `error` as opaque text and rely on the
  HTTP status for retry logic.

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

Use `ok(res, payload, status?)` and `fail(res, error, status?)` from
`src/utils/response.ts` for the generic envelope. Use `sendConflict(res, err)`
from `src/errors/problem.ts` for 409 problem+json.
