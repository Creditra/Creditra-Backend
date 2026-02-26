#!/usr/bin/env node
/**
 * CLI: run pending migrations then validate that core tables exist.
 * Usage: DATABASE_URL=... node --import tsx src/db/validate-cli.ts
 */
import { join } from 'path';
import { getConnection } from './client.js';
import { runPendingMigrations } from './migrations.js';
import { validateSchema } from './validate-schema.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function main(): Promise<void> {
  const client = getConnection();
  try {
    if (client.connect) await client.connect();
    await client.query('SELECT 1');
  } catch {
    console.error('Cannot connect to database. Set DATABASE_URL.');
    process.exitCode = 1;
    return;
  }
  try {
    const run = await runPendingMigrations(client, MIGRATIONS_DIR);
    if (run.length > 0) {
      console.log('Applied migrations:', run.join(', '));
    }
    await validateSchema(client);
    console.log('Schema validation passed.');
  } catch (err) {
    console.error('Validation failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
