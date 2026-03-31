#!/usr/bin/env node
/**
 * CLI: run pending migrations then validate that core tables exist.
 * 
 * Suitable for use as Kubernetes init container or pre-flight check.
 * Exits with non-zero code on failure.
 * 
 * Usage: DATABASE_URL=... node --import tsx src/db/validate-cli.ts
 * 
 * Environment variables:
 * - DATABASE_URL: PostgreSQL connection string (required)
 * - SKIP_COLUMN_CHECK: Set to 'true' to skip column validation
 * - SKIP_INDEX_CHECK: Set to 'true' to skip index validation
 */
import { join } from 'path';
import { getConnection } from './client.js';
import { runPendingMigrations } from './migrations.js';
import { validateSchema, SchemaValidationError } from './validate-schema.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function main(): Promise<void> {
  // Check DATABASE_URL is set
  if (!process.env['DATABASE_URL']) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('Usage: DATABASE_URL=postgresql://... npm run db:validate');
    process.exit(1);
  }

  const client = getConnection();
  
  try {
    // Test database connection
    console.log('Connecting to database...');
    if (client.connect) await client.connect();
    await client.query('SELECT 1');
    console.log('✓ Database connection successful');
  } catch (error) {
    console.error('ERROR: Cannot connect to database');
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
    }
    console.error('\nPlease check:');
    console.error('  - DATABASE_URL is correct');
    console.error('  - Database server is running');
    console.error('  - Network connectivity');
    process.exit(1);
  }

  try {
    // Run pending migrations
    console.log('\nChecking for pending migrations...');
    const run = await runPendingMigrations(client, MIGRATIONS_DIR);
    if (run.length > 0) {
      console.log(`✓ Applied ${run.length} migration(s):`);
      run.forEach((version) => console.log(`  - ${version}`));
    } else {
      console.log('✓ No pending migrations');
    }

    // Validate schema
    console.log('\nValidating schema...');
    const options = {
      skipColumnCheck: process.env['SKIP_COLUMN_CHECK'] === 'true',
      skipIndexCheck: process.env['SKIP_INDEX_CHECK'] === 'true',
    };

    await validateSchema(client, options);
    console.log('✓ Schema validation passed');
    
    // Success summary
    console.log('\n✅ Database is ready for traffic');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Schema validation failed\n');
    
    if (error instanceof SchemaValidationError) {
      // Structured error with details
      console.error(`ERROR: ${error.message}\n`);
      
      if (error.details.missingTables && error.details.missingTables.length > 0) {
        console.error('Missing tables:');
        error.details.missingTables.forEach((table) => {
          console.error(`  - ${table}`);
        });
        console.error('');
      }
      
      if (error.details.missingColumns && error.details.missingColumns.length > 0) {
        console.error('Missing columns:');
        error.details.missingColumns.forEach(({ table, column }) => {
          console.error(`  - ${table}.${column}`);
        });
        console.error('');
      }
      
      if (error.details.missingIndexes && error.details.missingIndexes.length > 0) {
        console.error('Missing indexes:');
        error.details.missingIndexes.forEach(({ table, index }) => {
          console.error(`  - ${table}.${index}`);
        });
        console.error('');
      }
      
      console.error('Action required:');
      console.error('  1. Ensure migrations have been applied: npm run db:migrate');
      console.error('  2. Check migration files in migrations/ directory');
      console.error('  3. Verify database schema matches expected structure');
    } else if (error instanceof Error) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error('ERROR: Unknown validation error');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();
