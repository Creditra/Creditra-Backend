import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  SUPPORTED_FIXTURES,
  verifyMigrationFixtures,
} from './migrationVerification.js';

describe('migration verification integration', () => {
  it('validates the checked-in SQL for fresh and upgraded databases', async () => {
    const reports = await verifyMigrationFixtures(
      join(process.cwd(), 'migrations'),
      SUPPORTED_FIXTURES,
    );
    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.valid)).toBe(true);
    expect(reports.map((report) => report.path)).toEqual(['fresh', 'upgrade']);
    expect(reports[0]?.pending).toEqual([
      '001_initial_schema',
      '002_add_interest_rate_to_credit_lines',
      '003_add_reconciliation_event_ledger',
      '004_add_credit_line_version',
    ]);
    expect(reports[1]?.pending).toEqual([
      '002_add_interest_rate_to_credit_lines',
      '003_add_reconciliation_event_ledger',
      '004_add_credit_line_version',
    ]);
  });

  it('proves the upgrade declares the new index without changing the base table set', async () => {
    const reports = await verifyMigrationFixtures(
      join(process.cwd(), 'migrations'),
      [{
        name: 'upgrade-contract',
        applied: ['001_initial_schema'],
        requiredTables: ['borrowers', 'credit_lines', 'risk_evaluations', 'transactions', 'events'],
        requiredIndexes: ['credit_lines_interest_rate_bps_idx'],
      }],
    );
    const report = reports[0];
    expect(report?.valid).toBe(true);
    expect(report?.missingTables).toEqual([]);
    expect(report?.missingIndexes).toEqual([]);
    expect(report?.descriptors.find((descriptor) => descriptor.version === '002_add_interest_rate_to_credit_lines')?.irreversible).toBe(true);
  });

  it('fails CI-style verification when a required object is absent', async () => {
    const reports = await verifyMigrationFixtures(
      join(process.cwd(), 'migrations'),
      [{
        name: 'required-object-contract',
        applied: [],
        requiredTables: ['borrowers', 'does_not_exist'],
        requiredIndexes: ['missing_index'],
        requiredConstraints: ['missing_constraint'],
      }],
    );
    const report = reports[0];
    expect(report?.valid).toBe(false);
    expect(report?.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'MISSING_REQUIRED_TABLE',
      'MISSING_REQUIRED_INDEX',
      'MISSING_REQUIRED_CONSTRAINT',
    ]));
  });

  it('keeps the report suitable for deterministic CI snapshots', async () => {
    const first = await verifyMigrationFixtures(
      join(process.cwd(), 'migrations'),
      SUPPORTED_FIXTURES,
    );
    const second = await verifyMigrationFixtures(
      join(process.cwd(), 'migrations'),
      [...SUPPORTED_FIXTURES].reverse(),
    );
    expect(second.reverse().map((report) => ({
      path: report.path,
      pending: report.pending,
      errors: report.errors,
      missingTables: report.missingTables,
      missingIndexes: report.missingIndexes,
    }))).toEqual(first.map((report) => ({
      path: report.path,
      pending: report.pending,
      errors: report.errors,
      missingTables: report.missingTables,
      missingIndexes: report.missingIndexes,
    })));
  });
});
