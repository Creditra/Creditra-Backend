# Database transaction strategy

This document describes how the Creditra backend enforces **atomic multi-write
credit mutations** so a mid-flow failure cannot leave the off-chain mirror
desynced from ledger rows (or from what API clients observe).

> Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [REPOSITORY_ARCHITECTURE.md](./REPOSITORY_ARCHITECTURE.md), [data-model.md](./data-model.md).

---

## Why transactions

Credit mutations often touch **more than one persistence step**:

| Mutation | Writes |
|---|---|
| `createCreditLine` | Ensure `borrowers` row + insert `credit_lines` (Postgres path) |
| `draw` | Insert `transactions` (`borrow`) + update credit-line utilization / re-read |
| `repay` | Insert `transactions` (`repay`) + update credit-line utilization / re-read |

Without a transaction boundary, a crash or query error after the first write
and before the second produces **partial state**: e.g. a ledger row without a
matching balance change, or a borrower without a credit line. That desyncs
reconciliation, available-credit calculations, and client views.

---

## Boundary placement

Transactions are opened at the **service layer**, not in HTTP routes and not
as nested BEGIN inside every repository method.

```
Route  →  CreditLineService.draw/repay/create  →  TransactionRunner
                │                                       │
                │  BEGIN                                │
                ├─► TransactionRepository.create        │
                ├─► CreditLineRepository.update/create  │
                │  COMMIT / ROLLBACK                    │
                ▼
         domain events (after commit only)
```

### Helper API

| Symbol | Location | Role |
|---|---|---|
| `withTransaction(client, work)` | `src/db/transaction.ts` | `BEGIN` → `work()` → `COMMIT`, or `ROLLBACK` on throw |
| `TransactionRunner` | same | Injectable function type used by services |
| `createDbTransactionRunner(client)` | same | Postgres-backed runner |
| `passthroughTransactionRunner` | same | No-op runner for in-memory / pure unit tests |

When `client` is `undefined`, `withTransaction` runs `work` without SQL control
statements. True multi-connection atomicity requires a live `DbClient`.

### Wiring

`Container.rebuildServices()` passes:

- `transactionRepository` — shared with draw/repay ledger writes
- `runInTransaction` — `createDbTransactionRunner(dbClient)` when `DATABASE_URL`
  is active and `NODE_ENV !== 'test'`, otherwise passthrough

Repositories that share the same `DbClient` connection participate in the open
transaction automatically (same session for `BEGIN`/`COMMIT`).

---

## Guarantees and non-guarantees

### Guaranteed (Postgres production path)

- Draw/repay either persist **both** the ledger row and the balance touch, or
  **neither**.
- Create runs repository multi-statement work inside one transaction so a
  failure after `ensureBorrower` does not leave an orphaned borrower without
  rolling back when the insert fails (same session).
- Domain events `credit.draw_confirmed` / `credit.repay_confirmed` /
  `credit.opened` are emitted **after** a successful commit. Subscribers never
  observe rolled-back state via those events.
- `credit.draw_requested` may fire before the write txn (intent signal); it is
  not a durability guarantee.

### Not guaranteed

- **In-memory repositories** use the passthrough runner: there is no SQL
  rollback. Atomicity tests for in-memory use an explicit draft/commit harness
  (see tests) to simulate the production contract.
- **Nested transactions** on one connection are not supported (no SAVEPOINT).
  Do not call `withTransaction` from inside another `withTransaction` on the
  same client.
- **On-chain / Soroban** submission is outside this boundary. Chain confirmation
  remains eventually consistent via the indexer / reconciliation pipeline.
- Single-statement updates (e.g. patch credit limit only) do not open a txn;
  PostgreSQL already treats one statement as atomic.

---

## Failure-injection tests

Regression coverage lives in:

- `src/db/transaction.test.ts` — control flow (`BEGIN`/`COMMIT`/`ROLLBACK`),
  injected failure on Nth data query, rollback error swallowed in favour of
  the original failure.
- `src/services/__tests__/CreditLineService.transactions.test.ts` — draw/repay
  multi-write atomicity, mid-flow ledger failure, mid-flow balance-update
  failure, no `*_confirmed` event after rollback, SQL control statements via
  `createDbTransactionRunner`.

Pattern used by service tests:

1. Inject a `TransactionRunner` that stages mutations in draft maps.
2. Throw on the second write.
3. Assert durable maps are unchanged (simulated rollback).

---

## Adding a new atomic mutation

1. Keep pure validation **outside** the runner (fail fast without `BEGIN`).
2. Put every multi-write step **inside** `this.runInTransaction(async () => { ... })`.
3. Emit success-side domain events **after** the runner returns.
4. Add a failure-injection test that throws after the first write and asserts
   no durable partial state.
5. Prefer reusing the shared `DbClient` already held by repositories rather
   than opening a second connection (which would not see the open txn).

---

## Operational notes

- The current Postgres wiring uses a single `pg.Client` per process (see
  `getConnection()`). All transactional work must run on that client. If the
  stack moves to a `Pool`, acquire one client for the whole
  `withTransaction` scope and pass it into repositories for that request.
- Keep transactions **short**: no HTTP calls, no Soroban RPC, no webhook
  delivery inside `runInTransaction`.
- Prefer idempotent ledger writes (or unique constraints) for retries at the
  HTTP edge; transactions alone do not make non-idempotent handlers safe under
  double-submit.
