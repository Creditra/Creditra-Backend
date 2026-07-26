# Cursor Pagination Standard

Creditra list endpoints share a single **cursor-based** pagination model.
Clients should prefer cursor mode for production traffic: it is stable under
concurrent inserts, does not require total counts, and uses **opaque** cursors
so internal sort keys are not part of the public contract.

Offset/`page` pagination remains available on some endpoints for backward
compatibility; new clients should use cursors.

## Query parameters

| Param | Type | Default | Bounds | Notes |
|---|---|---|---|---|
| `cursor` | string | — | opaque | Presence (even empty: `?cursor`) enables cursor mode |
| `limit` | int | endpoint default | 1–100 | Shared via `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` |

## Response shape

```json
{
  "items": [ /* resource-specific */ ],
  "pagination": {
    "limit": 25,
    "nextCursor": "eyJ2IjoxLCJ0IjoxNzAwMDAwMDAwMDAwLCJpIjoiLi4uIn0",
    "hasMore": true
  }
}
```

Field names for the item array vary by resource (`creditLines`, `transactions`,
`items`, …) but **`pagination` is always** `{ limit, nextCursor, hasMore }`.

- `nextCursor` is `null` when `hasMore` is `false`.
- Clients must treat cursors as **opaque**: pass them back unchanged; do not
  decode or construct them client-side.

## Ordering (deterministic)

Every cursor page is ordered by a composite key:

1. Primary timestamp (`createdAt` / `timestamp` / `updatedAt` / `at`)
2. Stable string id tie-break

| Endpoint | Order | Sort key |
|---|---|---|
| `GET /api/credit/lines?cursor` | ASC | `createdAt`, `id` |
| `GET /api/credit/lines/:id/transactions?cursor` | DESC | `timestamp`, `id` |
| `GET /api/admin/api-keys?cursor` | ASC | `createdAt`, `id` |
| `GET /api/admin/api-keys/audit?cursor` | DESC | `at`, composite id |
| `GET /api/webhooks/deliveries` | DESC | `updatedAt`, `drawId::url` |

## Cursor format (server-internal)

Cursors are **base64url**-encoded JSON:

```json
{ "v": 1, "t": 1700000000000, "i": "<tie-break-id>" }
```

- `v` — format version (`1`)
- `t` — epoch milliseconds of the sort timestamp
- `i` — unique tie-breaker string

Legacy credit-line cursors of the form `base64(timestamp|id)` are still
accepted during decode so in-flight clients are not broken mid-rollout.
New responses always mint the versioned opaque form.

Malformed cursors are handled **leniently** on list endpoints that predate the
standard (credit lines restart from the first page). Prefer not relying on that
behavior; mint cursors only from `nextCursor`.

## Shared implementation

| Module | Role |
|---|---|
| [`src/utils/cursorPagination.ts`](../src/utils/cursorPagination.ts) | encode/decode, clamp limit, in-memory page builder, SQL seek helper |
| [`src/schemas/pagination.schema.ts`](../src/schemas/pagination.schema.ts) | Zod query schemas |
| [`src/utils/constants.ts`](../src/utils/constants.ts) | `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `MIN_PAGE_SIZE` |

Repositories should either call `paginateArray` (in-memory) or over-fetch
`limit + 1` rows with a seek predicate and `buildPageFromOverfetch`.

## Client example

```typescript
async function fetchAllCreditLines(baseUrl: string) {
  const all = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const qs = new URLSearchParams({ limit: '50' });
    // Empty cursor engages cursor mode on the first page.
    qs.set('cursor', cursor ?? '');
    const res = await fetch(`${baseUrl}/api/credit/lines?${qs}`);
    const body = await res.json();
    all.push(...body.creditLines);
    cursor = body.pagination.nextCursor ?? undefined;
    hasMore = body.pagination.hasMore;
  }
  return all;
}
```

## Error handling

| Condition | HTTP | Message pattern |
|---|---|---|
| `limit` &lt; 1 | 400 | `Limit must be greater than 0` |
| `limit` &gt; 100 | 400 | `Limit cannot exceed 100` |
| Invalid filter (e.g. webhook `status`) | 400 | endpoint-specific |

## Migration

- Existing offset / page clients keep working when they omit `cursor`.
- To migrate: request `?cursor&limit=N`, then follow `pagination.nextCursor`
  until `hasMore` is false.
