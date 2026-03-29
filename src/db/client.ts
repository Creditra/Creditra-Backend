import { createRequire } from 'module';

/**
 * Database client interface for migrations and validation.
 * Allows tests to inject a mock without requiring a real PostgreSQL connection.
 */
export interface DbClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  connect?(): Promise<void>;
  end(): Promise<void>;
}

const require = createRequire(import.meta.url);

export function getConnection(): DbClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const pg = require('pg') as {
    Client: new (opts: { connectionString: string }) => DbClient;
  };
  return new pg.Client({ connectionString: url });
}
