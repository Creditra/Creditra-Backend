# Idempotent POST mutations

Creditra accepts an optional `Idempotency-Key` header on POST mutations. When a
client retries the same mutation with the same key, route, principal, and request
body, the API returns the first non-5xx response instead of running the handler a
second time.

## Scope

The idempotency scope is:

- HTTP method and request path.
- Principal, derived from `X-API-Key`, `X-Admin-Api-Key`, `Authorization`, or
  `walletAddress` when no auth header exists.
- SHA-256 hash of the parsed request body and query string.

The raw key, API key, bearer token, and wallet value are not stored in the cache;
only hashes are used.

## Replay behavior

- Missing `Idempotency-Key`: request runs normally.
- Same key and same request: returns the cached response with
  `Idempotency-Status: replayed`.
- Same key but different request body, route, or principal: returns `409`.
- Same key while the first request is still running:
  - In-memory store waits and returns the first response.
  - Postgres store returns `409` with `Retry-After: 1` to prevent duplicate
    processing across instances.
- 5xx responses are not cached, so clients can retry transient failures.

## Storage

Production deployments with `DATABASE_URL` use the `idempotency_keys` table from
`migrations/006_idempotency_keys.sql`. Test and local no-database runs use the
bounded in-memory store. Entries default to a 24-hour TTL.
