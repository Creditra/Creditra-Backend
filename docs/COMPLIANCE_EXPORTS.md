# Compliance Exports

Admin-only CSV/JSON export endpoints for audit and compliance workflows.

## Endpoints

All routes require the `X-Admin-Api-Key` header and live under `/api/admin/exports`.

| Method | Path | Resource |
|--------|------|----------|
| `GET` | `/api/admin/exports/credit-lines` | Credit lines |
| `GET` | `/api/admin/exports/transactions` | Transactions |
| `GET` | `/api/admin/exports/audit` | Credit lifecycle audit records |

## Query parameters

Shared on every export:

| Param | Required | Notes |
|-------|----------|-------|
| `from` | **yes** | Inclusive lower bound (ISO-8601 UTC) |
| `to` | **yes** | Inclusive upper bound (ISO-8601 UTC) |
| `format` | no | `json` (default) or `csv` |
| `limit` | no | Page size, default `1000`, max **`5000`** |
| `offset` | no | Pagination offset, default `0` |

Resource-specific filters:

- **credit-lines:** `status`, `walletAddress`
- **transactions:** `status`, `type`, `creditLineId`, `walletAddress`
- **audit:** `action`, `creditLineId`

## Anti-exfiltration controls

1. **Admin auth** — `adminAuth` middleware; `503` when `ADMIN_API_KEY` is unset.
2. **Required date range** — unbounded historical dumps are rejected.
3. **Max span 90 days** — `to - from` must be ≤ 90 days.
4. **Hard row ceiling** — at most 5 000 rows per request (`limit`).
5. **Strict rate limit** — default **5** export requests per window (`RATE_LIMIT_MAX_EXPORT`, window from `RATE_LIMIT_WINDOW_MS`).
6. **Streaming responses** — rows are written incrementally (`res.write`) so large pages do not build a single giant string.
7. **No-store cache** — `Cache-Control: no-store` on every export body.

When more matching rows exist beyond `limit`, JSON includes `meta.truncated: true` and both formats set `X-Export-Truncated: true`. Page with `offset` to continue.

## Response formats

### JSON

```json
{
  "data": [ { "...": "..." } ],
  "meta": {
    "resource": "credit-lines",
    "format": "json",
    "count": 1,
    "limit": 1000,
    "offset": 0,
    "truncated": false,
    "from": "2026-01-01T00:00:00.000Z",
    "to": "2026-01-31T23:59:59.999Z",
    "generatedAt": "2026-02-01T12:00:00.000Z"
  },
  "error": null
}
```

### CSV

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="creditra-<resource>-<timestamp>.csv"`
- First line is the header row; object fields (e.g. audit `details`) are JSON-stringified.

### Shared headers

| Header | Meaning |
|--------|---------|
| `X-Export-Count` | Rows in this response |
| `X-Export-Limit` | Applied limit |
| `X-Export-Offset` | Applied offset |
| `X-Export-Truncated` | `true` if more matches exist |

## Audit data source

Lifecycle events from the in-process event bus (`credit.opened`, `credit.draw_requested`, …) are written to an in-memory append-only store (capped) **and** stdout. Export `/audit` reads that store. Production deployments can swap the sink to persist into the `events` table without changing the export query surface.

## Examples

```bash
# JSON credit lines for January 2026
curl -H "X-Admin-Api-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/api/admin/exports/credit-lines?from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.999Z"

# CSV transactions
curl -H "X-Admin-Api-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/api/admin/exports/transactions?from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.999Z&format=csv" \
  -o transactions.csv

# Audit filtered by action
curl -H "X-Admin-Api-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/api/admin/exports/audit?from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.999Z&action=credit.opened"
```

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `ADMIN_API_KEY` | (unset → 503) | Admin header secret |
| `RATE_LIMIT_MAX_EXPORT` | `5` | Export requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Shared rate-limit window |

## Related

- [`SECURITY.md`](./SECURITY.md) — auth model and RBAC table
- [`src/routes/exports.ts`](../src/routes/exports.ts) — route handlers
- [`src/schemas/export.schema.ts`](../src/schemas/export.schema.ts) — validation ceilings
