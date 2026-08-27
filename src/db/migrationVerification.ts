import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listMigrationFiles, versionFromFilename } from './migrations.js';

export type MigrationDescriptor = {
  filename: string;
  version: string;
  sql: string;
  tables: string[];
  indexes: string[];
  constraints: string[];
  irreversible: boolean;
  rollbackNote: string | null;
};

export type MigrationVerificationErrorCode =
  | 'DUPLICATE_VERSION'
  | 'UNKNOWN_APPLIED_VERSION'
  | 'OUT_OF_ORDER_APPLIED_VERSION'
  | 'MISSING_ROLLBACK_NOTE'
  | 'MISSING_REQUIRED_TABLE'
  | 'MISSING_REQUIRED_INDEX'
  | 'MISSING_REQUIRED_CONSTRAINT';

export type MigrationVerificationError = {
  code: MigrationVerificationErrorCode;
  version: string;
  message: string;
};

export type MigrationVerificationReport = {
  path: 'fresh' | 'upgrade';
  applied: string[];
  pending: string[];
  descriptors: MigrationDescriptor[];
  errors: MigrationVerificationError[];
  missingTables: string[];
  missingIndexes: string[];
  missingConstraints: string[];
  valid: boolean;
};

export type MigrationFixture = {
  name: string;
  applied: readonly string[];
  requiredTables?: readonly string[];
  requiredIndexes?: readonly string[];
  requiredConstraints?: readonly string[];
};

const ROLLBACK_MARKER = /^\s*--\s*Rollback:\s*(.+)$/im;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** Parse the schema objects declared by one migration without executing SQL. */
export function describeMigration(filename: string, sql: string): MigrationDescriptor {
  const tables = uniqueSorted([
    ...[...sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w"]+)/gi)].map((match) =>
      match[1].replaceAll('"', ''),
    ),
  ]);
  const indexes = uniqueSorted([
    ...[...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w"]+)/gi)].map((match) =>
      match[1].replaceAll('"', ''),
    ),
  ]);
  const constraints = uniqueSorted([
    ...[...sql.matchAll(/CONSTRAINT\s+([\w"]+)/gi)].map((match) => match[1].replaceAll('"', '')),
    ...[...sql.matchAll(/([\w"]+)\s+UUID\s+PRIMARY\s+KEY/gi)].map((match) => `${match[1].replaceAll('"', '')}:primary_key`),
    ...[...sql.matchAll(/([\w"]+)\s+[^,\n]+REFERENCES\s+([\w"]+)/gi)].map((match) =>
      `${match[1].replaceAll('"', '')}:references:${match[2].replaceAll('"', '')}`,
    ),
  ]);
  const rollbackMatch = sql.match(ROLLBACK_MARKER);
  const rollbackNote = rollbackMatch?.[1]?.trim() ?? null;
  return {
    filename,
    version: versionFromFilename(filename),
    sql,
    tables,
    indexes,
    constraints,
    irreversible: rollbackNote?.toUpperCase().startsWith('IRREVERSIBLE') ?? false,
    rollbackNote,
  };
}

function orderedVersions(descriptors: readonly MigrationDescriptor[]): string[] {
  return descriptors
    .map((descriptor) => descriptor.version)
    .sort((left, right) => left.localeCompare(right));
}

/** Verify one fresh or upgraded schema path against a loaded migration set. */
export function verifyMigrationPath(
  descriptors: readonly MigrationDescriptor[],
  fixture: MigrationFixture,
): MigrationVerificationReport {
  const ordered = [...descriptors].sort((left, right) => left.version.localeCompare(right.version));
  const versions = orderedVersions(ordered);
  const errors: MigrationVerificationError[] = [];
  const seen = new Set<string>();
  for (const descriptor of ordered) {
    if (seen.has(descriptor.version)) {
      errors.push({
        code: 'DUPLICATE_VERSION',
        version: descriptor.version,
        message: `migration version ${descriptor.version} is declared more than once`,
      });
    }
    seen.add(descriptor.version);
    if (!descriptor.rollbackNote) {
      errors.push({
        code: 'MISSING_ROLLBACK_NOTE',
        version: descriptor.version,
        message: `migration ${descriptor.version} must document its rollback boundary`,
      });
    }
  }

  const known = new Set(versions);
  const applied = [...fixture.applied];
  for (const version of applied) {
    if (!known.has(version)) {
      errors.push({
        code: 'UNKNOWN_APPLIED_VERSION',
        version,
        message: `fixture references unknown migration ${version}`,
      });
    }
  }
  const knownApplied = applied.filter((version) => known.has(version));
  const expectedPrefix = versions.slice(0, knownApplied.length);
  if (knownApplied.some((version, index) => version !== expectedPrefix[index])) {
    errors.push({
      code: 'OUT_OF_ORDER_APPLIED_VERSION',
      version: knownApplied.find((version, index) => version !== expectedPrefix[index]) ?? '',
      message: 'applied migrations must form a prefix of the sorted migration sequence',
    });
  }

  const appliedSet = new Set(applied);
  const pending = versions.filter((version) => !appliedSet.has(version));
  const declaredTables = new Set(ordered.flatMap((descriptor) => descriptor.tables));
  const declaredIndexes = new Set(ordered.flatMap((descriptor) => descriptor.indexes));
  const declaredConstraints = new Set(ordered.flatMap((descriptor) => descriptor.constraints));
  const missingTables = (fixture.requiredTables ?? []).filter((name) => !declaredTables.has(name));
  const missingIndexes = (fixture.requiredIndexes ?? []).filter((name) => !declaredIndexes.has(name));
  const missingConstraints = (fixture.requiredConstraints ?? []).filter((name) => !declaredConstraints.has(name));
  for (const name of missingTables) errors.push({ code: 'MISSING_REQUIRED_TABLE', version: 'schema', message: `required table ${name} is not declared by any migration` });
  for (const name of missingIndexes) errors.push({ code: 'MISSING_REQUIRED_INDEX', version: 'schema', message: `required index ${name} is not declared by any migration` });
  for (const name of missingConstraints) errors.push({ code: 'MISSING_REQUIRED_CONSTRAINT', version: 'schema', message: `required constraint ${name} is not declared by any migration` });
  return {
    path: fixture.applied.length === 0 ? 'fresh' : 'upgrade',
    applied,
    pending,
    descriptors: ordered,
    errors,
    missingTables,
    missingIndexes,
    missingConstraints,
    valid: errors.length === 0,
  };
}

/** Load all SQL files and verify both a fresh database and supported upgrade fixtures. */
export async function verifyMigrationFixtures(
  migrationsDir: string,
  fixtures: readonly MigrationFixture[],
): Promise<MigrationVerificationReport[]> {
  const filenames = await listMigrationFiles(migrationsDir);
  const descriptors = await Promise.all(
    filenames.map(async (filename) => describeMigration(filename, await readFile(join(migrationsDir, filename), 'utf8'))),
  );
  return fixtures.map((fixture) => verifyMigrationPath(descriptors, fixture));
}

export const SUPPORTED_FIXTURES: readonly MigrationFixture[] = [
  {
    name: 'fresh-install',
    applied: [],
    requiredTables: ['borrowers', 'credit_lines', 'risk_evaluations', 'transactions', 'events'],
    requiredIndexes: [
      'borrowers_wallet_address_key',
      'credit_lines_borrower_id_idx',
      'credit_lines_status_idx',
      'risk_evaluations_borrower_id_idx',
      'transactions_credit_line_id_idx',
      'events_idempotency_key_key',
      'credit_lines_interest_rate_bps_idx',
    ],
    requiredConstraints: ['id:primary_key', 'borrower_id:references:borrowers'],
  },
  {
    name: 'upgrade-from-001',
    applied: ['001_initial_schema'],
    requiredTables: ['borrowers', 'credit_lines', 'risk_evaluations', 'transactions', 'events'],
    requiredIndexes: ['credit_lines_interest_rate_bps_idx'],
    requiredConstraints: ['id:primary_key', 'borrower_id:references:borrowers'],
  },
];
