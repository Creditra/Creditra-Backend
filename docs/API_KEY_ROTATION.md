# API Key Rotation Runbook

Creditra supports zero-downtime API key rotation via multiple active keys and a
revocation grace period. Only SHA-256 hashes of keys are stored; plaintext is
returned exactly once, at creation.

## Endpoints (admin-gated, `X-Admin-Api-Key`)

| Method | Path                         | Purpose                                  |
| ------ | ---------------------------- | ---------------------------------------- |
| POST   | `/api/admin/api-keys`        | Issue a new key. Returns plaintext once. |
| GET    | `/api/admin/api-keys`        | List key metadata (no secrets).          |
| DELETE | `/api/admin/api-keys/:id`    | Revoke a key (enters grace period).      |
| GET    | `/api/admin/api-keys/audit`  | Audit log of issue/revoke actions.       |

## Rotation procedure (no downtime)

1. **Issue** a new key:
   `POST /api/admin/api-keys` → record the returned `key` securely (shown once).
2. **Roll out** the new key to all clients.
3. **Revoke** the old key:
   `DELETE /api/admin/api-keys/{oldId}`. The old key remains valid during the
   grace period (default 24h) so any client mid-deploy keeps working.
4. After the grace window elapses the old key is rejected automatically.

## Staleness / security guarantees

- **Hashed at rest.** Only `sha256(key)` is stored. A store compromise does not
  leak usable keys.
- **Constant-time verification** prevents timing side channels.
- **Grace period** is configurable per `ApiKeyStore` instance
  (`new ApiKeyStore(gracePeriodMs)`); default is 24h.
- **At-least-one active key** must exist at all times — never revoke the last
  active key before issuing its replacement.

## Backward compatibility

Statically configured `API_KEYS` entries can be seeded into the store via
`seedFromEnv()` so existing keys keep working alongside dynamically issued ones.
