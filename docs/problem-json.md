# RFC 7807 problem+json error format

All error responses from the Creditra Backend use
[`application/problem+json`](https://datatracker.ietf.org/doc/html/rfc7807)
with a **stable taxonomy** so clients can branch on `code` (and optionally
`type`) instead of free-text messages.

Legacy envelope fields `data: null` and `error` (equal to `detail`) are still
present so older clients keep working.

## Response shape

```jsonc
{
  "type": "https://docs.creditra.dev/problems/validation_failed",
  "title": "Validation Error",
  "status": 400,
  "detail": "Validation failed",
  "code": "validation_failed",
  "details": [
    { "field": "walletAddress", "message": "Required" }
  ],
  "data": null,
  "error": "Validation failed"
}
```

| Field | Meaning |
|---|---|
| `type` | Documentation URI for the problem class (not fetched by the API). |
| `title` | Fixed short summary for the category. |
| `status` | HTTP status (matches the response status line). |
| `detail` | Occurrence-specific explanation (never a stack trace). |
| `code` | **Stable machine code** — preferred client branch key. |
| `details` | Optional field issues or safe context (no secrets). |
| `resource` | Optional resource kind (`credit_line`, `borrower`, …). |
| `retryAfter` | Optional seconds until retry (rate limit). |
| `data` / `error` | Legacy envelope compatibility. |

## Taxonomy (`code` → HTTP)

| `code` | HTTP | Category |
|---|---|---|
| `validation_failed` | 400 | Request schema / business validation |
| `unauthorized` | 401 | Missing credentials |
| `forbidden` | 403 | Invalid credentials / insufficient role |
| `not_found` | 404 | Missing resource |
| `duplicate_resource` | 409 | Conflict — duplicate create |
| `version_conflict` | 409 | Conflict — optimistic lock |
| `invalid_state_transition` | 409 | Conflict — illegal lifecycle change |
| `unique_constraint_violation` | 409 | Conflict — DB uniqueness |
| `payload_too_large` | 413 | Body size limit |
| `unsupported_media_type` | 415 | Wrong `Content-Type` |
| `rate_limited` | 429 | Token bucket exhausted |
| `upstream_failure` | 502 | Dependency failed |
| `upstream_timeout` | 504 | Dependency timed out |
| `service_unavailable` | 503 | Misconfigured / maintenance |
| `internal_error` | 500 | Unexpected failure |

## Security rules

- **No stack traces** in response bodies (any environment).
- **No secrets**, wallet addresses, API keys, or raw SQL constraint values that
  embed end-user identifiers in `detail` / `details`.
- For `internal_error` (and unexpected 5xx), `detail` is always the generic
  string `Internal server error`. Real causes go to structured logs only.

## Implementation

| Piece | Location |
|---|---|
| Taxonomy constants | `src/errors/taxonomy.ts` |
| Typed errors | `src/errors/AppError.ts`, `ConflictError.ts` |
| Translator / send | `src/errors/problem.ts` (`sendProblem`, `translateUnknownError`) |
| Global middleware | `src/middleware/errorHandler.ts` |
| Validation / auth / rate limit | Prefer `sendProblem(...)` at the edge |

Throw `AppError` (or subclasses) from services, or pass them to `next(err)`.
The central handler maps well-known `Error.name` values
(`ValidationError`, `NotFoundError`, `CreditLineNotFoundError`,
`VersionConflictError`, …) when typed errors are not yet used.

## OpenAPI

See `components.schemas.Problem` in `src/openapi.yaml`. Individual 4xx/5xx
responses should `$ref` that schema (or a category-specific alias).

## Related

- Legacy success envelope: [error-envelope.md](./error-envelope.md)
- Security checklist: [SECURITY.md](./SECURITY.md)
