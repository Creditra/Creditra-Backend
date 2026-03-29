import { describe, it, expect, vi } from 'vitest';
import type { DbClient } from './client.js';
import { missingTables, validateSchema } from './validate-schema.js';

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
});

describe('validateSchema', () => {
  it('does not throw when all expected tables exist', async () => {
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
    await expect(validateSchema(client)).resolves.toBeUndefined();
  });

  it('throws when any table is missing', async () => {
    const client = createMockClient();
    vi.mocked(client.query).mockResolvedValue({
      rows: [{ table_name: 'borrowers' }],
    });
    await expect(validateSchema(client)).rejects.toThrow('Missing tables:');
    await expect(validateSchema(client)).rejects.toThrow('credit_lines');
  });
});
