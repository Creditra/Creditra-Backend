# Request body size limits

Per-endpoint JSON body limits protect the API from large-payload denial-of-service while still allowing bulk ingest routes a higher ceiling.

## Defaults

| Scope | Path match | Limit | Constant / env |
|---|---|---|---|
| Default API | all paths without a more specific rule | **100 KiB** | `BODY_LIMIT_DEFAULT_BYTES` (default `102400`) |
| Bulk ingest | `/api/credit/lines/bulk` (+ subpaths) | **1 MiB** | `BODY_LIMIT_BULK_BYTES` (default `1048576`) |
| Parser ceiling | absolute max accepted by `express.json` | max of the above (override with `BODY_LIMIT_MAX_BYTES`) | safety net for chunked bodies |

Source of truth: [`src/config/bodyLimit.ts`](../src/config/bodyLimit.ts).

## How enforcement works

1. **Content-Type guard** — mutating requests with a body must declare `application/json` (else `415`).
2. **Path-aware early reject** — [`createPathAwareBodyLimitMiddleware`](../src/middleware/bodyLimit.ts) reads `Content-Length` and, when present and over the route limit, returns **413** immediately without buffering the body.
3. **JSON parser** — `express.json({ limit: maxBytes, verify })` uses the absolute ceiling; the `verify` hook re-checks the raw buffer against the **path-specific** limit (covers `Transfer-Encoding: chunked` where `Content-Length` is absent).
4. **errorHandler** — body-parser `entity.too.large` and `PayloadTooLargeError` map to the same 413 problem+json + envelope response.

### Fixed limit on a single route

```ts
import { createBodyLimitMiddleware } from '../middleware/bodyLimit.js';

router.post(
  '/lines/bulk',
  createBodyLimitMiddleware(1024 * 1024),
  handler,
);
```

Prefer path rules in `loadBodyLimitConfig()` for global path-based policy; use the factory when a router owns its own limit.

## 413 response shape

Status: `413 Payload Too Large`  
`Content-Type: application/problem+json`

```json
{
  "type": "https://httpstatuses.com/413",
  "title": "Payload Too Large",
  "status": 413,
  "detail": "Payload Too Large. Request body exceeds the maximum size of 100kb for this endpoint.",
  "limit": 102400,
  "limitLabel": "100kb",
  "data": null,
  "error": "Payload Too Large. Request body exceeds the maximum size of 100kb for this endpoint."
}
```

Headers:

| Header | Meaning |
|---|---|
| `X-Content-Length-Limit` | Max bytes allowed for this endpoint |
| `X-Content-Length-Received` | Observed size when known |

`data` / `error` mirror the project envelope ([`docs/error-envelope.md`](./error-envelope.md)) so existing clients keep working; RFC 7807 fields support problem-aware clients.

## Environment variables

```bash
# Optional overrides (bytes, positive integers)
BODY_LIMIT_DEFAULT_BYTES=102400
BODY_LIMIT_BULK_BYTES=1048576
BODY_LIMIT_MAX_BYTES=1048576
```

Invalid or non-positive values fall back to the compiled defaults.

## Reverse proxy recommendations

Node only sees what the edge allows. Set proxy limits **≥** `BODY_LIMIT_MAX_BYTES` so clients receive the API’s structured 413 instead of a generic gateway error.

### nginx

```nginx
# Must be ≥ BODY_LIMIT_MAX_BYTES (default 1m)
client_max_body_size 1m;
```

### Envoy

```yaml
per_connection_buffer_limit_bytes: 1048576  # ≥ BODY_LIMIT_MAX_BYTES
```

Or use a Lua/ext_authz filter; ensure the listener/http connection manager does not buffer-reject below the API max.

### AWS ALB / CloudFront / Cloudflare

- ALB does not impose a small fixed body cap comparable to nginx’s default 1m; still document app limits to clients.
- Cloudflare free/pro plan has upload limits by plan; ensure the plan limit is ≥ bulk limit if bulk is exposed publicly.
- Prefer terminating TLS at a proxy that can reject oversize bodies early under load.

### Defence in depth

| Layer | Role |
|---|---|
| CDN / WAF | Optional hard ceiling, bot filtering |
| Reverse proxy | `client_max_body_size` / buffer limits ≥ app max |
| App path-aware middleware | Per-endpoint policy + structured 413 |
| `express.json` limit | Absolute parser ceiling |

Do **not** set the proxy limit lower than bulk without also lowering `BODY_LIMIT_BULK_BYTES` / `BODY_LIMIT_MAX_BYTES`, or bulk clients will see opaque `413`/`502` from the proxy.

## Adding a new high-limit endpoint

1. Add a `{ pathPrefix, maxBytes }` rule in `loadBodyLimitConfig()` (`src/config/bodyLimit.ts`).
2. Ensure `maxBytes` ≤ `BODY_LIMIT_MAX_BYTES` (raise the env default if needed).
3. Confirm reverse proxy config allows the new ceiling.
4. Extend tests in `tests/middleware/bodyLimits.test.ts`.
5. Document the path in this file and in `docs/API.md`.

## Tests

- `tests/middleware/bodyLimits.test.ts` — default 413, bulk higher limit, problem+json shape, Content-Type 415.
- `src/config/__tests__/bodyLimit.test.ts` — config resolution and labels.
