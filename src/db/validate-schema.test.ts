import { describe, it, expect, vi } from 'vitest';
import type { DbClient } from './client.js';
import {
  missingTables,
  missingColumns,
  missingIndexes,
  validateSchema,
  SchemaValidationError,
} from './validate-schema.js';

function createMockClient(overrides: Partial<DbClient> = {}): DbClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('missingTables', () => {
  it('returns empty when all tables exist', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [
        { table_name: 'borrowers' },
        { table_name: 'credit_lines' },
        { table_name: 'risk_evaluations' },
        { table_name: 'transactions' },
        { table_name: 'events' },
      ],
    });
    const missing = await missingTables(client);
    expect(missing).toEqual([]);
  });

  it('returns missing table names', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [{ table_name: 'borrowers' }, { table_name: 'events' }],
    });
    const missing = await missingTables(client, [
      'borrowers',
      'credit_lines',
      'events',
    ]);
    expect(missing).toEqual(['credit_lines']);
  });

  it('returns all when none exist', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({ rows: [] });
    const missing = await missingTables(client, ['borrowers', 'events']);
    expect(missing).toEqual(['borrowers', 'events']);
  });

  it('uses default EXPECTED_TABLES when no list given', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [{ table_name: 'borrowers' }],
    });
    const missing = await missingTables(client);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing).toContain('credit_lines');
  });

  it('uses parameterized queries', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({ rows: [] });
    
    await missingTables(client, ['borrowers', 'credit_lines']);
    
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('$1'),
      ['borrowers', 'credit_lines']
    );
  });
});

describe('missingColumns', () => {
  it('returns empty when all columns exist', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [
        { column_name: 'id' },
        { column_name: 'wallet_address' },
        { column_name: 'created_at' },
      ],
    });
    
    const missing = await missingColumns(client, 'borrowers', [
      'id',
      'wallet_address',
      'created_at',
    ]);
    
    expect(missing).toEqual([]);
  });

  it('returns missing column names', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [{ column_name: 'id' }, { column_name: 'created_at' }],
    });
    
    const missing = await missingColumns(client, 'borrowers', [
      'id',
      'wallet_address',
      'created_at',
    ]);
    
    expect(missing).toEqual(['wallet_address']);
  });

  it('returns all when none exist', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({ rows: [] });
    
    const missing = await missingColumns(client, 'borrowers', ['id', 'name']);
    
    expect(missing).toEqual(['id', 'name']);
  });

  it('uses parameterized queries with table name', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({ rows: [] });
    
    await missingColumns(client, 'borrowers', ['id', 'name']);
    
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('$1'),
      ['borrowers', 'id', 'name']
    );
  });
});

describe('missingIndexes', () => {
  it('returns empty when all indexes exist', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [
        { indexname: 'borrowers_wallet_address_key' },
        { indexname: 'borrowers_pkey' },
      ],
    });
    
    const missing = await missingIndexes(client, 'borrowers', [
      'borrowers_wallet_address_key',
      'borrowers_pkey',
    ]);
    
    expect(missing).toEqual([]);
  });

  it('returns missing index names', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [{ indexname: 'borrowers_pkey' }],
    });
    
    const missing = await missingIndexes(client, 'borrowers', [
      'borrowers_wallet_address_key',
      'borrowers_pkey',
    ]);
    
    expect(missing).toEqual(['borrowers_wallet_address_key']);
  });

  it('returns all when none exist', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({ rows: [] });
    
    const missing = await missingIndexes(client, 'borrowers', ['idx1', 'idx2']);
    
    expect(missing).toEqual(['idx1', 'idx2']);
  });
});

describe('validateSchema', () => {
  it('passes when all tables, columns, and indexes exist', async () => {
    const client = createMockClient();
    
    // Mock responses for all queries
    vi.mocked(client.query).mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'borrowers' },
            { table_name: 'credit_lines' },
            { table_name: 'risk_evaluations' },
            { table_name: 'transactions' },
            { table_name: 'events' },
          ],
        };
      }
      if (sql.includes('information_schema.columns')) {
        // Return all required columns for any table
        return {
          rows: [
            { column_name: 'id' },
            { column_name: 'wallet_address' },
            { column_name: 'borrower_id' },
            { column_name: 'credit_limit' },
            { column_name: 'currency' },
            { column_name: 'status' },
            { column_name: 'risk_score' },
            { column_name: 'suggested_limit' },
            { column_name: 'interest_rate_bps' },
            { column_name: 'evaluated_at' },
            { column_name: 'credit_line_id' },
            { column_name: 'type' },
            { column_name: 'amount' },
            { column_name: 'event_type' },
            { column_name: 'created_at' },
          ],
        };
      }
      if (sql.includes('pg_indexes')) {
        // Return all required indexes for any table
        return {
          rows: [
            { indexname: 'borrowers_wallet_address_key' },
            { indexname: 'credit_lines_borrower_id_idx' },
            { indexname: 'credit_lines_status_idx' },
            { indexname: 'risk_evaluations_borrower_id_idx' },
            { indexname: 'transactions_credit_line_id_idx' },
            { indexname: 'events_idempotency_key_key' },
          ],
        };
      }
      return { rows: [] };
    });
    
    await expect(validateSchema(client)).resolves.toBeUndefined();
  });

  it('throws SchemaValidationError when tables are missing', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [{ table_name: 'borrowers' }],
    });
    
    await expect(validateSchema(client)).rejects.toThrow(SchemaValidationError);
    
    try {
      await validateSchema(client);
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const err = error as SchemaValidationError;
      expect(err.details.missingTables).toBeDefined();
      expect(err.details.missingTables).toContain('credit_lines');
      expect(err.message).toContain('Missing tables:');
    }
  });

  it('throws SchemaValidationError when columns are missing', async () => {
    const client = createMockClient();
    
    vi.mocked(client.query).mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'borrowers' },
            { table_name: 'credit_lines' },
            { table_name: 'risk_evaluations' },
            { table_name: 'transactions' },
            { table_name: 'events' },
          ],
        };
      }
      if (sql.includes('information_schema.columns')) {
        // Missing wallet_address column
        return { rows: [{ column_name: 'id' }, { column_name: 'created_at' }] };
      }
      if (sql.includes('pg_indexes')) {
        return {
          rows: [
            { indexname: 'borrowers_wallet_address_key' },
            { indexname: 'credit_lines_borrower_id_idx' },
            { indexname: 'credit_lines_status_idx' },
            { indexname: 'risk_evaluations_borrower_id_idx' },
            { indexname: 'transactions_credit_line_id_idx' },
            { indexname: 'events_idempotency_key_key' },
          ],
        };
      }
      return { rows: [] };
    });
    
    try {
      await validateSchema(client);
      expect.fail('Should have thrown SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const err = error as SchemaValidationError;
      expect(err.details.missingColumns).toBeDefined();
      expect(err.details.missingColumns!.length).toBeGreaterThan(0);
      expect(err.message).toContain('Missing required columns:');
    }
  });

  it('throws SchemaValidationError when indexes are missing', async () => {
    const client = createMockClient();
    
    vi.mocked(client.query).mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'borrowers' },
            { table_name: 'credit_lines' },
            { table_name: 'risk_evaluations' },
            { table_name: 'transactions' },
            { table_name: 'events' },
          ],
        };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id' },
            { column_name: 'wallet_address' },
            { column_name: 'borrower_id' },
            { column_name: 'credit_limit' },
            { column_name: 'currency' },
            { column_name: 'status' },
            { column_name: 'risk_score' },
            { column_name: 'suggested_limit' },
            { column_name: 'interest_rate_bps' },
            { column_name: 'evaluated_at' },
            { column_name: 'credit_line_id' },
            { column_name: 'type' },
            { column_name: 'amount' },
            { column_name: 'event_type' },
            { column_name: 'created_at' },
          ],
        };
      }
      if (sql.includes('pg_indexes')) {
        // Missing critical indexes
        return { rows: [{ indexname: 'borrowers_wallet_address_key' }] };
      }
      return { rows: [] };
    });
    
    try {
      await validateSchema(client);
      expect.fail('Should have thrown SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const err = error as SchemaValidationError;
      expect(err.details.missingIndexes).toBeDefined();
      expect(err.details.missingIndexes!.length).toBeGreaterThan(0);
      expect(err.message).toContain('Missing critical indexes:');
    }
  });

  it('skips column check when skipColumnCheck is true', async () => {
    const client = createMockClient();
    
    vi.mocked(client.query).mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'borrowers' },
            { table_name: 'credit_lines' },
            { table_name: 'risk_evaluations' },
            { table_name: 'transactions' },
            { table_name: 'events' },
          ],
        };
      }
      if (sql.includes('pg_indexes')) {
        return {
          rows: [
            { indexname: 'borrowers_wallet_address_key' },
            { indexname: 'credit_lines_borrower_id_idx' },
            { indexname: 'credit_lines_status_idx' },
            { indexname: 'risk_evaluations_borrower_id_idx' },
            { indexname: 'transactions_credit_line_id_idx' },
            { indexname: 'events_idempotency_key_key' },
          ],
        };
      }
      return { rows: [] };
    });
    
    await expect(
      validateSchema(client, { skipColumnCheck: true })
    ).resolves.toBeUndefined();
    
    // Should not query columns
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('information_schema.columns'),
      expect.anything()
    );
  });

  it('skips index check when skipIndexCheck is true', async () => {
    const client = createMockClient();
    
    vi.mocked(client.query).mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'borrowers' },
            { table_name: 'credit_lines' },
            { table_name: 'risk_evaluations' },
            { table_name: 'transactions' },
            { table_name: 'events' },
          ],
        };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id' },
            { column_name: 'wallet_address' },
            { column_name: 'borrower_id' },
            { column_name: 'credit_limit' },
            { column_name: 'currency' },
            { column_name: 'status' },
            { column_name: 'risk_score' },
            { column_name: 'suggested_limit' },
            { column_name: 'interest_rate_bps' },
            { column_name: 'evaluated_at' },
            { column_name: 'credit_line_id' },
            { column_name: 'type' },
            { column_name: 'amount' },
            { column_name: 'event_type' },
            { column_name: 'created_at' },
          ],
        };
      }
      return { rows: [] };
    });
    
    await expect(
      validateSchema(client, { skipIndexCheck: true })
    ).resolves.toBeUndefined();
    
    // Should not query indexes
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('pg_indexes'),
      expect.anything()
    );
  });

  it('combines multiple validation errors', async () => {
    const client = createMockClient();
    
    vi.mocked(client.query).mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        // Missing events table
        return {
          rows: [
            { table_name: 'borrowers' },
            { table_name: 'credit_lines' },
            { table_name: 'risk_evaluations' },
            { table_name: 'transactions' },
          ],
        };
      }
      return { rows: [] };
    });
    
    try {
      await validateSchema(client);
      expect.fail('Should have thrown SchemaValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const err = error as SchemaValidationError;
      expect(err.details.missingTables).toContain('events');
      expect(err.message).toContain('Missing tables:');
      expect(err.message).toContain('events');
    }
  });
});

describe('SchemaValidationError', () => {
  it('creates error with structured details', () => {
    const details = {
      missingTables: ['credit_lines'],
      missingColumns: [{ table: 'borrowers', column: 'wallet_address' }],
      missingIndexes: [{ table: 'borrowers', index: 'borrowers_wallet_address_key' }],
    };
    
    const error = new SchemaValidationError('Validation failed', details);
    
    expect(error.name).toBe('SchemaValidationError');
    expect(error.message).toBe('Validation failed');
    expect(error.details).toEqual(details);
  });
});
