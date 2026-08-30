# Credit-line optimistic concurrency

Credit-line state is shared by borrowers, administrators, reconciliation jobs,
and background workers. A request that reads version `n` must not overwrite a
write that already advanced the same row to version `n + 1`. Creditra uses
optimistic concurrency control (OCC) so conflicting writers receive an
explicit retryable response instead of silently losing an update.

## Contract

Every credit-line read exposes a positive integer `version`. New rows start at
`1`. Every successful update advances the version exactly once. An HTTP update
must include the version the caller observed:

```http
PUT /api/credit/lines/line-123
Content-Type: application/json

{"status":"suspended","expectedVersion":7}
```

The server validates `expectedVersion` at the boundary. Missing, blank,
fractional, negative, zero, non-numeric, and unsafe integer values are HTTP
400 validation failures. The repository then performs the atomic check.

## Atomic write

PostgreSQL uses one conditional statement:

```sql
UPDATE credit_lines
SET status = $1,
    updated_at = now(),
    version = version + 1
WHERE id = $2
  AND version = $3
RETURNING id;
```

The `WHERE version = $3` predicate is the concurrency boundary. It executes in
the database, not in the handler, so two requests racing on the same row cannot
both claim the same version. The first committed update returns the next row;
the losing update affects zero rows and is distinguished from a missing row by
a follow-up existence/read check.

The in-memory repository follows the same contract synchronously. It is not a
replacement for PostgreSQL locking, but keeping the behavior identical makes
unit and integration tests meaningful and prevents a development environment
from hiding stale-write bugs.

## Conflict response

A stale write returns HTTP 409 with stable conflict metadata:

```json
{
  "type": "https://creditra.example/problems/version_conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Credit line was modified concurrently ...",
  "code": "version_conflict",
  "resource": "credit_line",
  "details": {
    "expectedVersion": 7,
    "actualVersion": 8,
    "retryable": true,
    "retryWithVersion": 8
  },
  "data": null,
  "error": "Credit line was modified concurrently ..."
}
```

The response does not expose a wallet address, SQL statement, constraint name,
stack trace, or database connection detail. `retryWithVersion` is the fresh
version the caller should use after it has re-read the complete credit line.
The caller must not blindly replay the same payload against the same stale
version.

## Client retry algorithm

OCC conflicts are expected under contention and are safe to retry when the
business operation remains valid:

1. Read the credit line and its current version.
2. Build the desired mutation from that representation.
3. Send the mutation with `expectedVersion` equal to the read version.
4. On success, replace the local representation with the response.
5. On `409 version_conflict`, re-read the row.
6. Re-evaluate the desired mutation against the fresh state.
7. Retry with the fresh version, using bounded backoff.
8. Stop after the configured attempt limit and surface the conflict.

Step six matters. A limit increase, status transition, draw, or repayment may
no longer be valid after another writer changes the row. A generic HTTP retry
that only changes the version can turn a stale business decision into a valid
but incorrect update.

The shared policy exposes a small exponential backoff helper. Its defaults are
three attempts, a 25ms base delay, and a 2s maximum delay. Jitter is optional
and bounded. The helper gives guidance only; it does not sleep, re-read, or
retry a mutation automatically.

## All write paths

The repository update method is the only place that mutates persisted
credit-line fields. The service passes the version from its pre-flight read to
draw and repay updates as well as to direct patches. This prevents a draw or
repay from bypassing the guard while a direct admin update is protected.

The API route requires `expectedVersion` for direct `PUT` updates. Internal
service and repository calls remain compatible with older tests and migration
tools that intentionally exercise unconditional behavior; new production HTTP
writes cannot omit the guard. Existing rows without a populated version are
treated as version `1` during the compatibility window and are advanced on
their first successful update.

Deletes are not silently converted into updates. A delete racing with an
update follows the repository's existing row-existence contract. If a future
delete endpoint needs conditional semantics, it should accept an explicit
version and use the same atomic predicate rather than inventing a second
locking model.

## Exactly-once version advancement

The version is incremented in the same SQL statement as the field mutation.
There is no separate `SELECT`, increment, and `UPDATE` sequence. A no-op
read-only request does not increment the version. A successful update of one or
more fields increments it exactly once. A conflict increments it zero times.

This makes `version` useful for ETags and cache invalidation: a changed version
means the representation must be re-read, while a failed stale write cannot
make a client believe its local state was persisted.

## Failure modes and authorization

Version validation happens after request authentication middleware and before
the repository call. It returns a typed public validation code and never lets
malformed input reach SQL. Authorization failures remain distinct from
version conflicts; a caller cannot use a fresh version to gain permission to
modify another wallet's line.

A missing credit line remains 404. A stale version on an existing line is 409.
An invalid status transition remains its own 409 code. Duplicate-resource and
database-constraint conflicts retain their existing taxonomy. Consumers should
branch on `code`, not on the human-readable `detail` string.

## Testing matrix

The policy tests cover:

- new-row version initialization;
- integer and string normalization;
- blank, zero, negative, fractional, unsafe, and non-numeric rejection;
- stable conflict details and retry guidance;
- bounded exponential backoff and attempt exhaustion;
- optional jitter clamping;
- atomic compare-and-set success;
- stale compare-and-set rejection without invoking the mutation callback;
- API-body conversion into a versioned mutation command.

Repository tests cover persistence-specific behavior: two writes from version
one, sequential successful updates, conflict preservation, missing rows, and
the PostgreSQL conditional query parameters. Route tests should additionally
assert that missing or blank `expectedVersion` values are 400 and stale values
are 409 with `code = version_conflict`.

## Observability

Metrics and logs may count conflicts by route and resource, but must not log
wallet addresses or full request bodies. Recommended low-cardinality fields
are `resource=credit_line`, `operation=update|draw|repay`, and
`outcome=version_conflict`. The expected and actual versions are useful for a
test report but should be sampled carefully in production logs because they
can correlate request timing.

Alert on a sustained conflict-rate increase rather than on individual 409s.
High contention may indicate a caller retrying without re-reading, an
overly-broad mutation endpoint, or a job scheduling problem. OCC makes the
failure visible; it does not decide which business update should win.

## Migration and rollout

The `version` column must be non-null with a safe default of `1` for new rows.
Existing rows should be backfilled before the application begins requiring the
HTTP field. During a rolling deployment, old application instances may still
send unconditional repository updates; the database column remains safe, but
the API requirement should be enabled only once all callers understand 409.

After rollout:

1. inspect rows with null or invalid versions;
2. compare version advancement with successful mutation counts;
3. sample conflicts for stale-client causes;
4. verify draw and repay updates carry the pre-flight version;
5. verify error responses contain no sensitive details;
6. document the retry contract in client SDKs.

## Non-goals

This policy does not merge field-level edits, retain a historical audit trail,
choose a winner between conflicting business decisions, or add distributed
locks. It does not weaken authorization, transaction boundaries, or database
constraints. A caller that needs a semantic merge must read fresh state and
submit a new, intentional mutation.
