# Stable credit-line cursors

`GET /api/credit/lines?cursor=...` uses an opaque, versioned cursor. The first
page captures a `snapshotAt` upper bound; subsequent pages only return rows
created no later than that bound. This prevents a newly inserted credit line
from appearing in a later page and shifting the traversal underneath a client.

Rows are ordered by `(created_at ASC, id ASC)`. The unique id is the tie-breaker
when multiple rows share the same timestamp. A cursor contains the last row's
timestamp and id plus the snapshot boundary, but callers must treat the value as
opaque and return it unchanged.

The same contract is available for transaction/audit history at
`/api/credit/lines/{id}/transactions?cursor=...`. That traversal is ordered by
`(timestamp DESC, id DESC)` and applies the same snapshot upper bound. Existing
page-number responses remain unchanged when `cursor` is omitted.

Malformed or legacy cursors are treated as a fresh traversal for backwards
compatibility. Page size remains bounded by the service layer at 100 rows.
