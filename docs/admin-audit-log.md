# Admin Audit Log

Privileged operator actions are recorded in an append-only audit log for compliance review.

Recorded actions include API key issue/revoke, maintenance mode updates, and credit-line admin transitions such as suspend and close. Each record stores an actor fingerprint, action, target, redacted before/after snapshots, a correlation id, and a hash chained to the previous record.

## Security Model

- Raw admin API keys are never stored as actors. The actor value is a SHA-256 fingerprint prefix.
- Sensitive fields whose names look like passwords, tokens, API keys, private keys, seeds, or authorization headers are stored as `[REDACTED]`.
- The application exposes no update or delete path for audit records.
- Each record includes `previousHash` and `hash` so missing or edited records can be detected by replaying the chain.

## Query Endpoint

`GET /api/admin/audit-logs`

Headers:

- `X-Admin-Api-Key`: required.

Query parameters:

- `limit`: 1-100 records, default 50.
- `cursor`: pagination cursor returned by the previous response.
- `actor`: exact actor fingerprint.
- `action`: exact action name, such as `api_key.issued`.
- `targetType`: exact target type, such as `credit_line`.

Response body uses the standard `{ data, error }` envelope. `data.items` is newest first.
