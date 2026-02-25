import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { DbClient } from './client.js';

const SCHEMA_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Expected core tables that must exist after initial schema. */
export const EXPECTED_TABLES = [
  'borrowers',
  'credit_lines',
  'risk_evaluations',
  'transactions',
  'events',
] as const;

/**
 * Ensure schema_migrations table exists (for first-run or standalone migration).
 */
export async function ensureSchemaMigrations(client: DbClient): Promise<void> {
  await client.query(SCHEMA_MIGRATIONS_TABLE);
}

/**
 * Return sorted list of migration filenames (e.g. 001_initial_schema.sql) in the given directory.
 */
export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
  return files;
}

/**
 * Extract version string from migration filename (e.g. 001_initial_schema.sql -> 001_initial_schema).
 */
export function versionFromFilename(filename: string): string {
  if (!filename.endsWith('.sql')) return filename;
  return filename.slice(0, -4);
}

/**
 * Get applied migration versions from schema_migrations.
 */
export async function getAppliedVersions(client: DbClient): Promise<string[]> {
  await ensureSchemaMigrations(client);
  const result = await client.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  const rows = result.rows as { version: string }[];
  return rows.map((r) => r.version);
}

/**
 * Apply a single migration file (run its SQL and record version).
 */
export async function applyMigration(
  client: DbClient,
  migrationsDir: string,
  filename: string
): Promise<void> {
  const path = join(migrationsDir, filename);
  const sql = await readFile(path, 'utf-8');
  await client.query(sql);
  const version = versionFromFilename(filename);
  await client.query(
    'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now()) ON CONFLICT (version) DO NOTHING',
    [version]
  );
}

/**
 * Run all pending migrations in the given directory.
 * Uses process.cwd() if migrationsDir is not absolute to resolve relative to cwd.
 */
export async function runPendingMigrations(
  client: DbClient,
  migrationsDir: string
): Promise<string[]> {
  const applied = await getAppliedVersions(client);
  const files = await listMigrationFiles(migrationsDir);
  const appliedSet = new Set(applied);
  const run: string[] = [];
  for (const file of files) {
    const version = versionFromFilename(file);
    if (appliedSet.has(version)) continue;
    await applyMigration(client, migrationsDir, file);
    run.push(version);
    appliedSet.add(version);
  }
  return run;
}
