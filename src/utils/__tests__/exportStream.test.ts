import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { escapeCsvField, flattenForExport, streamCsv, streamJson } from '../exportStream.js';

function mockRes(): Response & { chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    chunks,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
    },
  };
  return res as unknown as Response & { chunks: string[] };
}

describe('exportStream helpers', () => {
  it('escapes CSV fields with quotes and commas', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('flattens nested objects for CSV', () => {
    const flat = flattenForExport({
      id: '1',
      when: new Date('2026-01-01T00:00:00.000Z'),
      details: { ok: true },
    });
    expect(flat.id).toBe('1');
    expect(flat.when).toBe('2026-01-01T00:00:00.000Z');
    expect(flat.details).toBe('{"ok":true}');
  });

  it('streams CSV with header and rows', () => {
    const res = mockRes();
    streamCsv(
      res,
      ['id', 'name'],
      [
        { id: '1', name: 'alpha' },
        { id: '2', name: 'be,ta' },
      ],
      'out.csv',
    );
    const body = res.chunks.join('');
    expect(body).toBe('id,name\n1,alpha\n2,"be,ta"\n');
    expect((res as unknown as { headers: Record<string, string> }).headers['content-type']).toContain(
      'text/csv',
    );
  });

  it('streams JSON envelope incrementally', () => {
    const res = mockRes();
    streamJson(
      res,
      [{ id: 'a' }, { id: 'b' }],
      {
        resource: 'credit-lines',
        format: 'json',
        count: 2,
        limit: 10,
        offset: 0,
        truncated: false,
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T00:00:00.000Z',
        generatedAt: '2026-02-01T00:00:00.000Z',
      },
    );
    const body = JSON.parse(res.chunks.join('')) as {
      data: Array<{ id: string }>;
      meta: { count: number };
      error: null;
    };
    expect(body.error).toBeNull();
    expect(body.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(body.meta.count).toBe(2);
  });
});
