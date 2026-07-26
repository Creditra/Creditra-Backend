# API versioning and deprecation policy

Creditra Backend exposes a **versioned** HTTP surface and keeps the previous
unversioned paths available for a defined transition window.

## Canonical base path

| Surface | Prefix | Status |
|---|---|---|
| **v1 (current)** | `/api/v1/*` | Stable — preferred for all new clients |
| Legacy (compat) | `/api/*` (without `v1`) | Deprecated — same handlers, deprecation headers |
| Ops / docs | `/health`, `/docs`, `/docs.json` | Unversioned (probe and documentation only) |

Examples:

| Legacy | Versioned |
|---|---|
| `GET /api/credit/lines` | `GET /api/v1/credit/lines` |
| `POST /api/risk/evaluate` | `POST /api/v1/risk/evaluate` |
| `GET /api/reconciliation/status` | `GET /api/v1/reconciliation/status` |

OpenAPI (`src/openapi.yaml`, served at `/docs` and `/docs.json`) documents the
**versioned** paths only.

## Response headers

| Header | When | Meaning |
|---|---|---|
| `X-API-Version` | All `/api/v1/*` and legacy `/api/*` responses | Major API version in use (`1`) |
| `Deprecation` | Legacy `/api/*` only | `true` — resource is deprecated (RFC 9745) |
| `Sunset` | Legacy `/api/*` only | HTTP-date after which the legacy path may be removed (RFC 8594) |
| `Link` | Legacy `/api/*` only | `< /api/v1/... >; rel="successor-version"` (RFC 5829) |

Non-API routes (`/health`, `/docs`) do **not** send these headers.

### Configuring sunset

| Variable | Default | Description |
|---|---|---|
| `API_LEGACY_SUNSET` | `Thu, 31 Dec 2026 23:59:59 GMT` | RFC 7231 HTTP-date for the `Sunset` header on legacy routes |

Invalid values fall back to the default.

## Compatibility window

1. **Now:** both `/api/v1/*` and unversioned `/api/*` are served by the same
   routers. Behaviour is identical aside from deprecation headers on legacy.
2. **Before sunset:** clients should migrate to `/api/v1/*`. Mobile/web SDKs
   should treat `Deprecation` / `Sunset` / `Link` as migration signals.
3. **After sunset:** unversioned `/api/*` mounts may be removed in a major
   release. Removal will be announced in `CHANGELOG.md` and release notes.

Health checks and Swagger stay unversioned so load balancers and operator tools
do not need path rewrites during the migration.

## Implementation map

| Piece | Location |
|---|---|
| Policy + path helpers | [`src/config/apiVersion.ts`](../src/config/apiVersion.ts) |
| Header middleware | [`src/middleware/apiVersion.ts`](../src/middleware/apiVersion.ts) |
| Router mounts | [`src/index.ts`](../src/index.ts) |
| OpenAPI (v1 paths) | [`src/openapi.yaml`](../src/openapi.yaml) |
| Tests | `src/config/__tests__/apiVersion.test.ts`, `src/middleware/__tests__/apiVersion.test.ts`, `src/tests/apiVersion.integration.test.ts` |

## Client guidance

1. Prefer `/api/v1/...` for all new code.
2. When you still call unversioned paths, log a warning if `Deprecation: true`
   is present and schedule migration before the `Sunset` date.
3. Use the `Link` successor URL (or prepend `/api/v1` after `/api`) when rewriting
   client base paths programmatically.
