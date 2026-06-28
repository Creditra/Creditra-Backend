# Time Handling (UTC-only)

The backend standardises on **UTC** for every persisted, logged, and
API-facing timestamp. This prevents the time-zone drift bugs that would
otherwise corrupt reconciliation diffs and audit trails when the server,
database, and chain disagree on "now".

## Rules

1. **Always UTC.** Emit timestamps as ISO-8601 with a `Z` suffix and
   millisecond precision (`2026-06-29T12:34:56.789Z`).
2. **Use the helpers in [`src/utils/time.ts`](../src/utils/time.ts):**
   - `nowUtcIso()` — current instant as a UTC ISO string (server-derived).
   - `toUtcIso(date)` — normalise a `Date` to a UTC ISO string.
   - `parseUtc(value)` — parse an ISO string or epoch-ms number as UTC,
     returning `null` on invalid input. Offset-less and date-only strings are
     interpreted as UTC, never local time.
   - `isUtcIso(value)` — assert a string is a `Z`-suffixed UTC ISO timestamp
     (used at API/persistence boundaries and in tests).
3. **Never use locale-aware formatters** (`toLocaleString`, `toDateString`,
   `toString`) for any timestamp that is stored, logged, compared, or returned
   to a client. They render in the host's local zone and silently drift.

## Timestamp sources: chain vs server

| Timestamp | Source | Notes |
|---|---|---|
| Horizon event `created_at` / ledger close time | **Chain** | Already UTC; normalise via `parseUtc` / `toUtcIso` before use. |
| `WebhookPayload.data.horizonTimestamp` | **Chain** | Passed through from the Horizon event. |
| `WebhookPayload.timestamp` (envelope) | **Server** | When the webhook was generated (`nowUtcIso()`). |
| DB `TIMESTAMPTZ` columns (`created_at`, `evaluated_at`, …) | **Server** | Postgres stores instants in UTC; `DEFAULT now()` is UTC. |
| `Transaction.processedAt`, `RiskEvaluation.expiresAt` | **Server** | Derived from server clock. |
| Reconciliation comparisons | **Both** | Chain and server timestamps are compared only after both are normalised to UTC ISO. |

## Testing

`src/utils/__tests__/time.test.ts` asserts UTC formatting, stable round-trip
parsing independent of the host time zone, rejection of offset-bearing
timestamps, and `null`-on-invalid parsing — guarding against accidental
local-time usage.
