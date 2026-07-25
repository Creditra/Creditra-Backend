# ETag / conditional GET caching

Read-heavy endpoints support **HTTP validators** so clients can avoid
re-downloading unchanged payloads. This is API-level caching via
`ETag` + `If-None-Match` (RFC 9110), not a server-side response cache.

## Covered endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/credit/lines/:id` | Credit-line summary / detail |
| `GET` | `/api/credit/lines/:id/transactions` | Filtered + paginated history |
| `GET` | `/api/dashboard/summary` | Aggregate dashboard read model |

Error responses (`4xx` / `5xx`) do **not** carry an `ETag`.

## Wire protocol

### Full response (`200 OK`)

```http
HTTP/1.1 200 OK
ETag: "dGVzdGhhc2g…"
Cache-Control: private, must-revalidate
Content-Type: application/json

{"data":{…},"error":null}
```

### Conditional revalidation (`304 Not Modified`)

```http
GET /api/credit/lines/cl_abc HTTP/1.1
If-None-Match: "dGVzdGhhc2g…"
```

```http
HTTP/1.1 304 Not Modified
ETag: "dGVzdGhhc2g…"
Cache-Control: private, must-revalidate
```

The body is empty. Clients must keep using the representation they already hold.

## How the ETag is computed

Implementation: [`src/utils/etag.ts`](../src/utils/etag.ts).

1. Build the standard success envelope `{ data, error: null }`.
2. Serialize with `JSON.stringify` (Dates → ISO-8601, same as Express `res.json`).
3. SHA-256 hash, truncated base64url, wrapped in double quotes → strong ETag.

Because the hash covers the **full JSON body**, any change to the underlying
resource (limits, status, `version`, `updatedAt`, new transactions, different
filter/page slice, dashboard `generatedAt`, …) produces a different ETag.

## Client usage

```ts
let etag: string | undefined;
let cached: CreditLine | undefined;

async function loadLine(id: string): Promise<CreditLine> {
  const headers: HeadersInit = {};
  if (etag) headers['If-None-Match'] = etag;

  const res = await fetch(`/api/credit/lines/${id}`, { headers });

  if (res.status === 304 && cached) {
    return cached; // still current
  }

  const body = await res.json();
  etag = res.headers.get('ETag') ?? undefined;
  cached = body.data;
  return cached!;
}
```

Weak tags (`W/"…"`) and comma-separated `If-None-Match` lists are accepted via
weak comparison. `If-None-Match: *` always yields `304` when a representation
exists.

## Cache-Control semantics

`private, must-revalidate`:

- **`private`** — do not store in shared (CDN / proxy) caches. Credit-line and
  wallet data must not leak across tenants.
- **`must-revalidate`** — once stale, caches must revalidate with the origin
  before reuse. Paired with ETags this keeps bandwidth low without serving
  outdated numbers after a draw/repay/status change.

There is no long `max-age`; freshness is entirely validator-driven.

## Security notes

- ETags are opaque content hashes — they do not encode secrets, but they do
  confirm that the client previously received a given representation. Treat
  them as non-sensitive validators.
- Conditional GET is only applied on **successful** reads. Auth failures and
  not-found responses never short-circuit to `304`.
- Changing filters or pagination on `/transactions` yields a different ETag;
  clients must not reuse a validator from another query string.

## Implementation checklist (for new read endpoints)

1. After loading the resource, call `okWithEtag(req, res, data)` instead of `ok`.
2. Ensure the payload includes every field that clients treat as state (so
   mutations naturally change the hash).
3. Add integration coverage: initial ETag, `304` on match, new ETag after
   mutation.
4. Document the endpoint in the table above and in OpenAPI (`ETag` header +
   `304` response).

## Related

- Helpers: [`src/utils/etag.ts`](../src/utils/etag.ts)
- Status constant: `HTTP_NOT_MODIFIED` in [`src/utils/httpStatus.ts`](../src/utils/httpStatus.ts)
- Envelope: [`docs/error-envelope.md`](./error-envelope.md)
- API overview: [`docs/API.md`](./API.md)
