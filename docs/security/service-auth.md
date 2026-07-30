# Internal service authentication: JWT service tokens

Replaces long-lived shared API keys with short-lived, signed JWT service tokens for
internal service-to-service calls.

## Format

A minimal, dependency-free JWT (`header.payload.signature`, base64url, HS256 only).
No external JWT library is used, so verification has no supply-chain surface beyond
Node's built-in `crypto` module.

- `iss`: `creditra-backend`
- `aud`: `creditra-internal`
- `sub`: calling service account name (e.g. `reconciliation-worker`)
- `permissions`: string array of granted scopes
- `iat` / `exp`: issued-at / expiry (default TTL 5 minutes, max 1 hour)

## Minting a token (admin-only)

```
POST /api/admin/service-tokens
X-Admin-Api-Key: <ADMIN_API_KEY>
Content-Type: application/json

{ "serviceAccount": "reconciliation-worker", "permissions": ["reconcile:run"], "ttlSeconds": 300 }
```

Returns `{ token, expiresAt }`. Tokens are short-lived by design — callers should
re-mint rather than requesting long expiries.

## Verifying a token on a route

```ts
import { requireServiceToken } from '../middleware/serviceAuth.js';

router.post('/internal/reconcile', requireServiceToken('reconcile:run'), handler);
```

`requireServiceToken(permission?)` returns 401 when the `Authorization: Bearer <token>`
header is missing, and 403 when the token is invalid, expired, or lacks the required
permission. On success, `req.serviceAccount` carries the verified claims.

## Key rotation without downtime

```
POST /api/admin/service-tokens/rotate
X-Admin-Api-Key: <ADMIN_API_KEY>
```

Rotating adds a new signing key used for all newly minted tokens. The previous keys
remain valid for verification for a retention window (last 3 keys), so tokens minted
just before a rotation are not invalidated mid-flight — no coordinated deploy or
downtime is required.

By default the signing secret is generated in-process (`SERVICE_TOKEN_SECRET` env var
override for a fixed value across replicas/restarts).

## Migration plan from shared API keys

This is additive, not a breaking replacement: `requireServiceToken` middleware is
independent of `createApiKeyMiddleware` (`X-API-Key`), which continues to work
unchanged. Adopt route-by-route:

1. Mint a service token for each internal caller and update it to send
   `Authorization: Bearer <token>` instead of `X-API-Key`.
2. Add `requireServiceToken(...)` to the route (can run alongside the existing
   API-key check during the migration window — accept either until all callers
   have switched).
3. Once all callers of a route have migrated, remove the API-key check for that
   route.
