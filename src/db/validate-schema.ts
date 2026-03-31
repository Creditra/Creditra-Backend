import type { DbClient } from './client.js';
import { EXPECTED_TABLES } from './migrations.js';

/**
 * Validation error with structured details for programmatic handling.
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly details: {
      missingTables?: string[];
      missingColumns?: Array<{ table: string; column: string }>;
      missingIndexes?: Array<{ table: string; index: string }>;
    }
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/**
 * Required columns for critical tables (credit and risk operations).
 * Format: { tableName: [columnName, ...] }
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  borrowers: ['id', 'wallet_address', 'created_at'],
  credit_lines: ['id', 'borrower_id', 'credit_limit', 'currency', 'status', 'created_at'],
  risk_evaluations: ['id', 'borrower_id', 'risk_score', 'suggested_limit', 'interest_rate_bps', 'evaluated_at'],
  transactions: ['id', 'credit_line_id', 'type', 'amount', 'currency', 'created_at'],
  events: ['id', 'event_type', 'created_at'],
};

/**
 * Critical indexes that must exist for performance and correctness.
 * Format: { tableName: [indexName, ...] }
 */
const REQUIRED_INDEXES: Record<string, string[]> = {
  borrowers: ['borrowers_wallet_address_key'],
  credit_lines: ['credit_lines_borrower_id_idx', 'credit_lines_status_idx'],
  risk_evaluations: ['risk_evaluations_borrower_id_idx'],
  transactions: ['transactions_credit_line_id_idx'],
  events: ['events_idempotency_key_key'],
};

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
 * Check that required columns exist in the given table.
 * Returns list of missing columns; empty if all exist.
 */
export async function missingColumns(
  client: DbClient,
  tableName: string,
  requiredColumns: string[]
): Promise<string[]> {
  const placeholders = requiredColumns.map((_, i) => `$${i + 2}`).join(', ');
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name IN (${placeholders})`,
    [tableName, ...requiredColumns]
  );
  const found = (result.rows as { column_name: string }[]).map(
    (r) => r.column_name
  );
  const foundSet = new Set(found);
  return requiredColumns.filter((c) => !foundSet.has(c));
}

/**
 * Check that required indexes exist on the given table.
 * Returns list of missing index names; empty if all exist.
 */
export async function missingIndexes(
  client: DbClient,
  tableName: string,
  requiredIndexes: string[]
): Promise<string[]> {
  const placeholders = requiredIndexes.map((_, i) => `$${i + 2}`).join(', ');
  const result = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = $1 AND indexname IN (${placeholders})`,
    [tableName, ...requiredIndexes]
  );
  const found = (result.rows as { indexname: string }[]).map(
    (r) => r.indexname
  );
  const foundSet = new Set(found);
  return requiredIndexes.filter((i) => !foundSet.has(i));
}

/**
 * Validate that the core schema is present and complete.
 * 
 * Checks:
 * 1. All EXPECTED_TABLES exist
 * 2. Required columns exist in critical tables (credit_lines, risk_evaluations)
 * 3. Critical indexes exist for performance and correctness
 * 
 * Throws SchemaValidationError with structured details if validation fails.
 * Suitable for use as Kubernetes init container or pre-flight check.
 * 
 * @param client - Database client connection
 * @param options - Validation options
 * @param options.skipColumnCheck - Skip column validation (default: false)
 * @param options.skipIndexCheck - Skip index validation (default: false)
 * @throws {SchemaValidationError} If validation fails
 */
export async function validateSchema(
  client: DbClient,
  options: { skipColumnCheck?: boolean; skipIndexCheck?: boolean } = {}
): Promise<void> {
  const errors: string[] = [];
  const details: {
    missingTables?: string[];
    missingColumns?: Array<{ table: string; column: string }>;
    missingIndexes?: Array<{ table: string; index: string }>;
  } = {};

  // Check 1: Tables exist
  const missing = await missingTables(client);
  if (missing.length > 0) {
    details.missingTables = missing;
    errors.push(`Missing tables: ${missing.join(', ')}`);
  }

  // Check 2: Required columns exist (only if tables exist)
  if (!options.skipColumnCheck && missing.length === 0) {
    const missingCols: Array<{ table: string; column: string }> = [];
    
    for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const missing = await missingColumns(client, tableName, columns);
      for (const col of missing) {
        missingCols.push({ table: tableName, column: col });
      }
    }

    if (missingCols.length > 0) {
      details.missingColumns = missingCols;
      const formatted = missingCols.map((m) => `${m.table}.${m.column}`).join(', ');
      errors.push(`Missing required columns: ${formatted}`);
    }
  }

  // Check 3: Critical indexes exist (only if tables exist)
  if (!options.skipIndexCheck && missing.length === 0) {
    const missingIdxs: Array<{ table: string; index: string }> = [];
    
    for (const [tableName, indexes] of Object.entries(REQUIRED_INDEXES)) {
      const missing = await missingIndexes(client, tableName, indexes);
      for (const idx of missing) {
        missingIdxs.push({ table: tableName, index: idx });
      }
    }

    if (missingIdxs.length > 0) {
      details.missingIndexes = missingIdxs;
      const formatted = missingIdxs.map((m) => `${m.table}.${m.index}`).join(', ');
      errors.push(`Missing critical indexes: ${formatted}`);
    }
  }

  if (errors.length > 0) {
    throw new SchemaValidationError(errors.join('; '), details);
  }
}
