# Audit integrity and redaction

Creditra financial and authorization changes use the append-only `AuditLedger`
service. The ledger is a structured record stream with tenant ownership,
credential redaction, a SHA-256 hash chain, explicit retention, and a
read-only integrity verifier.

## Record shape

Each record contains an ID, tenant ID, actor, action, entity type, entity ID,
before/after snapshots, metadata, timestamp, the previous record hash, and its
own hash. Financial helpers prefix actions with `financial.` so monitoring can
group draws, repayments, fees, and status transitions consistently.

The canonical hash input is the JSON serialization of every record field
except `hash`, in object insertion order. The first record has
`previousHash: null`; every later record links to the hash immediately before
it. A database adapter should preserve these fields exactly and use an
append-only table policy for normal application credentials.

## Redaction boundary

`redactAuditState` deep-copies object and array values. Keys containing
`password`, `secret`, `token`, `credential`, `private_key`, `privatekey`,
`api_key`, `apikey`, or `authorization` become `[REDACTED]`. Bearer values and
Stellar secret-key-shaped values are redacted even if stored under a neutral
field name. Unsupported runtime values are replaced with a safe marker or a
decimal string for bigint amounts.

Redaction happens before hashing, persistence, or returning a record. A caller
cannot mutate a returned snapshot back into the ledger because `append` and
`list` return defensive copies. Raw access tokens, API keys, database
credentials, and private keys must never be placed in `before`, `after`, or
`metadata` in the first place; redaction is a second line of defense.

## Tenant isolation

Every record requires a non-empty `tenantId`. `list(tenantId)` filters by exact
tenant equality and returns no records from neighboring tenants. The service
does not implement a cross-tenant fallback or an “all tenants” response for a
tenant-scoped caller. Administrative aggregation should be a separately
authorized operation that requests the full ledger explicitly.

Tenant IDs and actor IDs are audit context, not credentials. They can be
logged for traceability according to the data policy, while authorization
headers and raw tokens are always excluded.

## Integrity verification

`verify()` recomputes every record hash and checks each previous-hash link. It
returns a structured report:

```ts
{
  valid: boolean,
  checked: number,
  issues: Array<{
    recordId: string,
    code: 'HASH_MISMATCH' | 'CHAIN_BREAK' | 'TENANT_MISMATCH',
    message: string
  }>
}
```

`AuditLedger.fromRecords` is the trusted persistence-adapter boundary for
rehydration and allows startup or scheduled verification without exposing a
mutable internal collection. Hash mismatch indicates changed fields or a
wrong hash. Chain break indicates a missing, reordered, or replaced record.
The verifier never repairs records and is safe to run repeatedly.

For a production database, pair this service with database permissions that
allow inserts and selects to the application role but deny `UPDATE` and
`DELETE` on the audit table. Retention workers need a distinct, reviewed
permission because retention is the only intentional removal path.

## Retention

Retention is explicit rather than implicit in `append`. The policy has a
maximum age and a maximum record count. `retain(now)` removes records older
than the cutoff, then retains the newest records within the count limit. It
returns removed and remaining counts for metrics. Retention must be applied
only after exporting records required by legal, accounting, or incident
policies.

Retention can make a complete historical hash chain unavailable. Persist the
last retained hash or an independent checkpoint before deleting old records
if long-term continuity is required. A checkpoint is not a substitute for
record-level verification; it is an anchor for the retained segment.

## Financial mutation integration

Credit-line draw, repayment, and transaction-status paths call the financial
audit helper after validation and before returning success. A failed
validation therefore emits no financial success event. Audit writes should
not be silently swallowed in production: if the durable audit repository is
unavailable, the mutation policy must choose between failing closed and using
a durable retry queue. The in-memory development ledger is intended for local
tests and process-lifetime behavior only.

The audit record describes what the application accepted; it does not prove
that an on-chain transaction finalized. Chain transaction hashes and
confirmation state should be recorded as separate after-state fields once
available.

## API and access policy

The service intentionally has no update method and no general-purpose delete
method. Normal APIs must expose audit records read-only. A future HTTP audit
route should require an admin scope, apply tenant filtering before
serialization, paginate by immutable `(at, id)` order, and expose integrity
reports separately from record retrieval. Error responses should use stable
codes and must not echo query credentials or database exceptions.

Operator tooling should alert on invalid reports, repeated chain breaks, and
unexpected tenant IDs. Preserve the report, deployment version, and scan time
as incident evidence without copying redacted source data into an unredacted
log channel.

## Test guarantees

The ledger tests cover nested and neutral-key redaction, bigint/unsupported
values, hash linking, defensive copies, tenant isolation, financial action
namespacing, invalid identity and retention inputs, tampering, chain breaks,
retention age/count limits, and repeatable verification. These tests are
designed to run without a database while matching the invariants required by a
durable adapter.
