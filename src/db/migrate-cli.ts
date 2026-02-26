#!/usr/bin/env node
/**
 * CLI: apply pending migrations.
 * Usage: DATABASE_URL=... node --import tsx src/db/migrate-cli.ts
 */
import { join } from 'path';
import { getConnection } from './client.js';
import { runPendingMigrations } from './migrations.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function main(): Promise<void> {
  const client = getConnection();
  try {
    if (client.connect) await client.connect();
    await client.query('SELECT 1');
  } catch (e) {
    console.error('Cannot connect to database. Set DATABASE_URL.');
    process.exitCode = 1;
    return;
  }
  try {
    const run = await runPendingMigrations(client, MIGRATIONS_DIR);
    if (run.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log('Applied migrations:', run.join(', '));
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
