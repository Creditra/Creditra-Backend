import { describe, expect, it } from 'vitest';
import {
  describeMigration,
  verifyMigrationPath,
  type MigrationDescriptor,
} from './migrationVerification.js';

const initialSql = `
-- Rollback: IRREVERSIBLE — restore a backup before removing the schema.
CREATE TABLE borrowers (id UUID PRIMARY KEY, wallet_address TEXT NOT NULL);
CREATE TABLE credit_lines (id UUID PRIMARY KEY, borrower_id UUID REFERENCES borrowers(id));
CREATE UNIQUE INDEX borrowers_wallet_address_key ON borrowers (wallet_address);
CREATE INDEX credit_lines_borrower_id_idx ON credit_lines (borrower_id);
`;

const upgradeSql = `
-- Rollback: IRREVERSIBLE — rates written by this migration must be preserved.
ALTER TABLE credit_lines ADD COLUMN interest_rate_bps INTEGER NOT NULL DEFAULT 0;
CREATE INDEX credit_lines_interest_rate_bps_idx ON credit_lines (interest_rate_bps);
`;

function descriptors(): MigrationDescriptor[] {
  return [
    describeMigration('002_add_interest_rate_to_credit_lines.sql', upgradeSql),
    describeMigration('001_initial_schema.sql', initialSql),
  ];
}

describe('describeMigration', () => {
  it('extracts tables, indexes, constraints, and rollback metadata', () => {
    const descriptor = describeMigration('001_initial_schema.sql', initialSql);
    expect(descriptor.version).toBe('001_initial_schema');
    expect(descriptor.tables).toEqual(['borrowers', 'credit_lines']);
    expect(descriptor.indexes).toEqual([
      'borrowers_wallet_address_key',
      'credit_lines_borrower_id_idx',
    ]);
    expect(descriptor.constraints).toContain('id:primary_key');
    expect(descriptor.constraints).toContain('borrower_id:references:borrowers');
    expect(descriptor.irreversible).toBe(true);
    expect(descriptor.rollbackNote).toContain('IRREVERSIBLE');
  });

  it('does not mistake an absent rollback marker for an irreversible declaration', () => {
    const descriptor = describeMigration('003_missing.sql', 'CREATE TABLE later (id UUID);');
    expect(descriptor.irreversible).toBe(false);
    expect(descriptor.rollbackNote).toBeNull();
  });

  it('captures upgrade indexes without inventing table declarations', () => {
    const descriptor = describeMigration('002_upgrade.sql', upgradeSql);
    expect(descriptor.tables).toEqual([]);
    expect(descriptor.indexes).toEqual(['credit_lines_interest_rate_bps_idx']);
  });
});

describe('verifyMigrationPath', () => {
  it('passes a fresh-install fixture and reports every migration as pending', () => {
    const report = verifyMigrationPath(descriptors(), {
      name: 'fresh-install',
      applied: [],
    });
    expect(report.path).toBe('fresh');
    expect(report.valid).toBe(true);
    expect(report.pending).toEqual(['001_initial_schema', '002_add_interest_rate_to_credit_lines']);
    expect(report.errors).toEqual([]);
  });

  it('passes an upgrade fixture from the previous supported schema', () => {
    const report = verifyMigrationPath(descriptors(), {
      name: 'upgrade-from-001',
      applied: ['001_initial_schema'],
    });
    expect(report.path).toBe('upgrade');
    expect(report.valid).toBe(true);
    expect(report.pending).toEqual(['002_add_interest_rate_to_credit_lines']);
  });

  it('rejects an unknown applied version with a stable error code', () => {
    const report = verifyMigrationPath(descriptors(), {
      name: 'unknown',
      applied: ['001_initial_schema', '999_future'],
    });
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'UNKNOWN_APPLIED_VERSION',
      version: '999_future',
    }));
  });

  it('verifies required schema objects and reports missing indexes explicitly', () => {
    const report = verifyMigrationPath(descriptors(), {
      name: 'schema-contract',
      applied: [],
      requiredTables: ['borrowers', 'credit_lines'],
      requiredIndexes: ['credit_lines_status_idx', 'missing_index'],
      requiredConstraints: ['id:primary_key'],
    });
    expect(report.valid).toBe(false);
    expect(report.missingTables).toEqual([]);
    expect(report.missingIndexes).toEqual(['credit_lines_status_idx', 'missing_index']);
    expect(report.missingConstraints).toEqual([]);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'MISSING_REQUIRED_INDEX',
      version: 'schema',
    }));
  });

  it('rejects an out-of-order upgrade fixture', () => {
    const report = verifyMigrationPath(descriptors(), {
      name: 'out-of-order',
      applied: ['002_add_interest_rate_to_credit_lines'],
    });
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'OUT_OF_ORDER_APPLIED_VERSION',
    }));
  });

  it('rejects duplicate versions and migrations without rollback notes', () => {
    const duplicate = describeMigration('001_initial_schema.sql', initialSql);
    const missing = describeMigration('003_missing.sql', 'CREATE TABLE later (id UUID);');
    const report = verifyMigrationPath([...descriptors(), duplicate, missing], {
      name: 'bad-metadata',
      applied: [],
    });
    expect(report.valid).toBe(false);
    expect(report.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'DUPLICATE_VERSION',
      'MISSING_ROLLBACK_NOTE',
    ]));
  });

  it('keeps report output deterministic when descriptors arrive in another order', () => {
    const first = verifyMigrationPath(descriptors(), { name: 'fresh', applied: [] });
    const second = verifyMigrationPath([...descriptors()].reverse(), { name: 'fresh', applied: [] });
    expect(second.pending).toEqual(first.pending);
    expect(second.errors).toEqual(first.errors);
    expect(second.descriptors.map((descriptor) => descriptor.version)).toEqual(
      first.descriptors.map((descriptor) => descriptor.version),
    );
  });
});
