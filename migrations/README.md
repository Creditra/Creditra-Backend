# Migrations

SQL migrations for the Creditra PostgreSQL schema. The data model is documented in [docs/data-model.md](../docs/data-model.md).

## Strategy

- **Location:** All migration files live in this directory.
- **Naming:** `NNN_short_snake_case_description.sql` (e.g. `001_initial_schema.sql`). Use three-digit sequence numbers and underscores; no spaces.
- **Order:** Migrations are applied in lexicographic filename order. Never edit or delete a migration that has already been applied in any environment.
- **Tracking:** The table `schema_migrations` stores applied versions (`version` primary key, `applied_at`). Your deployment process should run only migrations whose `version` is not yet present.
- **Rollback:** This project does not ship automatic down-migrations. Document rollback steps (e.g. `DROP TABLE ...`) in migration comments or a runbook when needed.
- **Conventions:** Tables and columns use `snake_case`; PKs are `id` (uuid); FKs are `{entity}_id`; timestamps are `created_at` / `updated_at` (timestamptz).

## Applying migrations

### Using psql

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require"
psql "$DATABASE_URL" -f migrations/001_initial_schema.sql
```

### Using the project script

From the repo root:

```bash
npm run db:migrate
```

Requires `DATABASE_URL` in the environment. The script applies pending migrations and records them in `schema_migrations`.

## Validating the schema

To validate that the schema applies cleanly and expected tables exist (e.g. in CI):

```bash
npm run db:validate
```

This runs the initial migration (or all pending migrations) and checks for the presence of the core tables. Requires a running PostgreSQL instance and `DATABASE_URL`.

## Verifying migration paths

Run `npm run db:verify` in CI and before applying a release. This static
verification loads every migration and checks both supported fixtures:

- `fresh-install`: no applied versions; all migrations must form the pending path;
- `upgrade-from-001`: the previous supported schema is applied; only the next migration may be pending.

The verifier also checks that applied versions form a prefix, rejects unknown
or out-of-order fixtures, extracts declared tables/indexes/constraints, and
requires every migration to carry a `-- Rollback:` note. Mark a migration
`-- Rollback: IRREVERSIBLE — ...` when its changes cannot safely be reversed
without a backup or manual data review. The verifier is intentionally static;
CI should pair it with a disposable PostgreSQL job that runs `db:migrate` on a
fresh database and an upgrade fixture, then runs `db:validate` to inspect the
resulting tables, columns, and indexes.

The verification report is deterministic: migration versions, pending paths,
declared schema objects, and validation errors are sorted before they are
printed. This keeps CI output stable and makes a failed run straightforward to
compare with the previous release.

### Rollback boundaries

The runner intentionally has no automatic down-migration command. A rollback
must be chosen with the data owner because a column drop, type narrowing, or
destructive rewrite may discard production data. Every SQL file therefore
declares a rollback note, even when the note says that a backup and manual
review are required. An irreversible marker is documentation and a release
gate; it does not attempt to make a destructive operation safe.

### CI recommendation

CI should execute the following checks in order:

1. Run `npm run db:verify` without a database to catch filename, ordering,
   rollback metadata, and expected-object mistakes.
2. Start a disposable PostgreSQL instance and run `npm run db:migrate` from an
   empty database.
3. Run `npm run db:validate` and query `pg_indexes` for critical indexes.
4. Restore a fixture containing the previous schema version and run the
   pending migration path.
5. Run `npm run db:validate` again and retain the migration output as a CI
   artifact.

The static verifier complements, rather than replaces, database execution.
SQL syntax, permissions, lock behavior, existing data, and PostgreSQL
extension availability still need coverage in the disposable database job.

Never edit a migration that has been applied in a shared environment. Add a
new numbered file, update its rollback note, and extend the representative
upgrade fixture when introducing another schema change.

The migration version is the filename without `.sql`; keep that identifier
stable in deployment records and incident reports.

## Files

| File                     | Description                    |
|--------------------------|--------------------------------|
| `001_initial_schema.sql` | Borrowers, credit lines, risk evaluations, transactions, events, indexes |
