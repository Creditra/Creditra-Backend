import { join } from 'node:path';
import { SUPPORTED_FIXTURES, verifyMigrationFixtures } from './migrationVerification.js';

const reports = await verifyMigrationFixtures(join(process.cwd(), 'migrations'), SUPPORTED_FIXTURES);
for (const report of reports) {
  const label = report.path === 'fresh' ? 'fresh install' : `upgrade after ${report.applied.at(-1)}`;
  console.log(`${label}: ${report.valid ? 'valid' : 'invalid'}; pending=${report.pending.join(',') || 'none'}`);
  for (const error of report.errors) console.error(`${error.code} ${error.version}: ${error.message}`);
}
if (reports.some((report) => !report.valid)) process.exitCode = 1;
