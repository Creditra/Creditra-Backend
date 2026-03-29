import type { DbClient } from './client.js';
import { EXPECTED_TABLES } from './migrations.js';

/**
 * Check that the given tables exist in the current schema (public).
 * Returns list of missing table names; empty if all exist.
 */
export async function missingTables(
  client: DbClient,
  tables: readonly string[] = EXPECTED_TABLES
): Promise<string[]> {
  const placeholders = tables.map((_, i) => `$${i + 1}`).join(', ');
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
    [...tables]
  );
  const found = (result.rows as { table_name: string }[]).map(
    (r) => r.table_name
  );
  const foundSet = new Set(found);
  return tables.filter((t) => !foundSet.has(t));
}

/**
 * Validate that the core schema is present (all EXPECTED_TABLES exist).
 * Throws if any are missing.
 */
export async function validateSchema(client: DbClient): Promise<void> {
  const missing = await missingTables(client);
  if (missing.length > 0) {
    throw new Error(`Missing tables: ${missing.join(', ')}`);
  }
}
