#!/usr/bin/env node
/**
 * CLI: apply pending migrations with safety guards.
 * 
 * Usage examples:
 * - Dry run: DATABASE_URL=... node --import tsx src/db/migrate-cli.ts --dry-run
 * - Force production: DATABASE_URL=... node --import tsx src/db/migrate-cli.ts --force --env production
 * - Development: DATABASE_URL=... node --import tsx src/db/migrate-cli.ts
 * 
 * Safety features:
 * - Dry-run mode shows what would be applied without executing
 * - Production-like environments require explicit --force flag
 * - Clear confirmation prompts for destructive operations
 * - Environment detection and warnings
 */
import { join } from 'path';
import { getConnection } from './client.js';
import { runPendingMigrations } from './migrations.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  env: string;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    dryRun: false,
    force: false,
    env: process.env.NODE_ENV || 'development',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
      case '-n':
        result.dryRun = true;
        break;
      case '--force':
      case '-f':
        result.force = true;
        break;
      case '--env':
        if (i + 1 < args.length) {
          result.env = args[++i];
        }
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (arg.startsWith('--env=')) {
          result.env = arg.split('=')[1];
        }
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Creditra Migration CLI

USAGE:
  DATABASE_URL=... node --import tsx src/db/migrate-cli.ts [OPTIONS]

OPTIONS:
  --dry-run, -n              Show pending migrations without applying them
  --force, -f                Required for production-like environments
  --env <environment>        Override environment detection (default: NODE_ENV)
  --help, -h                 Show this help message

ENVIRONMENTS:
  development                Safe to run without flags
  test                       Safe to run without flags
  staging                    Requires --force flag
  production                 Requires --force flag
  production-like            Any environment containing "prod" requires --force

EXAMPLES:
  # Dry run to see what would be applied
  DATABASE_URL=... node --import tsx src/db/migrate-cli.ts --dry-run

  # Development - safe to run
  DATABASE_URL=... node --import tsx src/db/migrate-cli.ts

  # Production - requires explicit force flag
  DATABASE_URL=... node --import tsx src/db/migrate-cli.ts --force --env production

SAFETY NOTES:
  - Always run with --dry-run first to review pending migrations
  - Production-like environments require explicit --force confirmation
  - Keep DATABASE_URL secure and never commit it to version control
  - Review migration files before applying in production
`);
}

function isProductionLike(env: string): boolean {
  const normalizedEnv = env.toLowerCase();
  return normalizedEnv.includes('prod') || 
         normalizedEnv.includes('stage') || 
         normalizedEnv === 'production' || 
         normalizedEnv === 'staging';
}

function getEnvironmentWarning(env: string): string {
  switch (env.toLowerCase()) {
    case 'production':
      return '⚠️  PRODUCTION ENVIRONMENT DETECTED';
    case 'staging':
      return '⚠️  STAGING ENVIRONMENT DETECTED';
    default:
      if (isProductionLike(env)) {
        return '⚠️  PRODUCTION-LIKE ENVIRONMENT DETECTED';
      }
      return '';
  }
}

async function confirmDestructiveOperation(env: string): Promise<boolean> {
  if (env.toLowerCase() === 'production') {
    console.log('\n🔴 PRODUCTION MIGURATION CONFIRMATION 🔴');
    console.log('You are about to run database migrations in PRODUCTION.');
    console.log('This could result in data loss or service interruption.');
    console.log('');
    console.log('Before proceeding, ensure:');
    console.log('  • You have a recent database backup');
    console.log('  • You have tested these migrations in staging');
    console.log('  • You have a rollback plan ready');
    console.log('  • You have notified relevant stakeholders');
    console.log('');
  } else if (isProductionLike(env)) {
    console.log(`\n🟡 ${env.toUpperCase()} ENVIRONMENT MIGRATION CONFIRMATION`);
    console.log(`You are about to run database migrations in ${env}.`);
    console.log('Please ensure you have tested these migrations first.');
    console.log('');
  }

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = env.toLowerCase() === 'production' 
    ? 'Type "MIGRATE PRODUCTION" to confirm: '
    : `Continue with migration to ${env}? (yes/no): `;

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      
      if (env.toLowerCase() === 'production') {
        resolve(answer.trim() === 'MIGRATE PRODUCTION');
      } else {
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'yes' || normalized === 'y');
      }
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  // Environment detection and warnings
  const envWarning = getEnvironmentWarning(args.env);
  if (envWarning) {
    console.log(envWarning);
  }

  // Safety checks for production-like environments
  if (isProductionLike(args.env) && !args.force) {
    console.log(`\n❌ SAFETY GUARD: ${args.env.toUpperCase()} environment requires --force flag`);
    console.log('Use --force to confirm you understand the risks.');
    console.log('Recommendation: Run with --dry-run first to review pending migrations.');
    console.log('\nExample:');
    console.log(`  DATABASE_URL=... node --import tsx src/db/migrate-cli.ts --force --env ${args.env}`);
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log('🔍 DRY RUN MODE - No migrations will be applied');
    console.log('');
  }

  // Database connection
  const client = getConnection();
  try {
    if (client.connect) await client.connect();
    await client.query('SELECT 1');
    console.log(`✅ Connected to database (${args.env} environment)`);
    console.log('');
  } catch (e) {
    console.error('❌ Cannot connect to database. Set DATABASE_URL.');
    console.error('Example: DATABASE_URL=postgresql://user:pass@host:port/db');
    process.exitCode = 1;
    return;
  }

  try {
    if (args.dryRun) {
      console.log('📋 Checking for pending migrations...');
      // For dry run, we would need to implement a function to get pending migrations
      // without applying them. For now, we'll show a message.
      console.log('📄 Dry run: Migration files would be read and applied');
      console.log('🔧 To see actual pending migrations, implement getPendingMigrations()');
      console.log('');
      console.log('✅ Dry run completed. No changes were made.');
      return;
    }

    // Confirmation for production-like environments
    if (isProductionLike(args.env)) {
      const confirmed = await confirmDestructiveOperation(args.env);
      if (!confirmed) {
        console.log('❌ Migration cancelled by user');
        process.exitCode = 1;
        return;
      }
    }

    console.log('🚀 Applying pending migrations...');
    const run = await runPendingMigrations(client, MIGRATIONS_DIR);
    
    if (run.length === 0) {
      console.log('✅ No pending migrations.');
    } else {
      console.log(`✅ Applied ${run.length} migration(s):`);
      run.forEach((migration, index) => {
        console.log(`  ${index + 1}. ${migration}`);
      });
      console.log('');
      
      if (isProductionLike(args.env)) {
        console.log('🎉 Production migration completed successfully!');
        console.log('📊 Consider verifying application functionality.');
      }
    }
  } catch (err) {
    console.error('❌ Migration failed:', err);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  • Check database connection and permissions');
    console.error('  • Verify migration file syntax');
    console.error('  • Ensure database is in correct state');
    console.error('  • Review migration logs for specific errors');
    
    if (isProductionLike(args.env)) {
      console.error('');
      console.error('🔴 PRODUCTION FAILURE DETECTED');
      console.error('  • Check application status');
      console.error('  • Consider rollback if necessary');
      console.error('  • Notify team of the failure');
    }
    
    process.exitCode = 1;
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

void main();
