import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  clampLimit,
  paginateArray,
  buildPageFromOverfetch,
  toPaginationMeta,
  parseCursorQuery,
  compareCursorKeysAsc,
  InvalidCursorError,
  CURSOR_VERSION,
} from '../cursorPagination.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

interface Row {
  id: string;
  createdAt: Date;
  label: string;
}

function row(id: string, ms: number, label = id): Row {
  return { id, createdAt: new Date(ms), label };
}

const getKey = (r: Row) => ({ t: r.createdAt.getTime(), i: r.id });

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor key opaquely', () => {
    const key = { t: 1_700_000_000_000, i: 'abc-123' };
    const cursor = encodeCursor(key);
    expect(cursor).not.toContain('|');
    expect(cursor).not.toContain(key.i);
    expect(decodeCursor(cursor)).toEqual(key);
  });

  it('embeds the current cursor version', () => {
    const cursor = encodeCursor({ t: 1, i: 'x' });
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    expect(JSON.parse(raw).v).toBe(CURSOR_VERSION);
  });

  it('decodes legacy base64(timestamp|id) cursors', () => {
    const legacy = Buffer.from('1700000000000|legacy-id', 'utf8').toString('base64');
    expect(decodeCursor(legacy)).toEqual({ t: 1_700_000_000_000, i: 'legacy-id' });
  });

  it('returns null for empty / missing cursors', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for malformed cursors in non-strict mode', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor('!!!')).toBeNull();
  });

  it('throws InvalidCursorError in strict mode', () => {
    expect(() => decodeCursor('not-a-cursor', { strict: true })).toThrow(InvalidCursorError);
  });
});

describe('clampLimit', () => {
  it('defaults when undefined', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('accepts bounds', () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('rejects zero and oversized limits with credit-line-compatible messages', () => {
    expect(() => clampLimit(0)).toThrow('Limit must be greater than 0');
    expect(() => clampLimit(MAX_PAGE_SIZE + 1)).toThrow(`Limit cannot exceed ${MAX_PAGE_SIZE}`);
  });
});

describe('paginateArray', () => {
  const items = [
    row('a', 1000),
    row('b', 2000),
    row('c', 3000),
    row('d', 4000),
    row('e', 5000),
  ];

  it('returns the first page and a nextCursor when more remain', () => {
    const page = paginateArray(items, { limit: 2, getKey, order: 'asc' });
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();
    expect(page.limit).toBe(2);
  });

  it('continues from nextCursor without overlap', () => {
    const first = paginateArray(items, { limit: 2, getKey });
    const second = paginateArray(items, { cursor: first.nextCursor, limit: 2, getKey });
    expect(second.items.map((r) => r.id)).toEqual(['c', 'd']);
    const firstIds = new Set(first.items.map((r) => r.id));
    for (const r of second.items) expect(firstIds.has(r.id)).toBe(false);
  });

  it('returns hasMore=false and null cursor on the last page', () => {
    const first = paginateArray(items, { limit: 3, getKey });
    const second = paginateArray(items, { cursor: first.nextCursor, limit: 3, getKey });
    expect(second.items.map((r) => r.id)).toEqual(['d', 'e']);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('handles empty collections', () => {
    const page = paginateArray([], { limit: 10, getKey });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('starts from the beginning on invalid cursor (non-strict)', () => {
    const page = paginateArray(items, { cursor: 'bogus', limit: 2, getKey });
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('throws on invalid cursor when strictCursor is set', () => {
    expect(() =>
      paginateArray(items, { cursor: 'bogus', limit: 2, getKey, strictCursor: true }),
    ).toThrow(InvalidCursorError);
  });

  it('supports DESC order for newest-first lists', () => {
    const page = paginateArray(items, { limit: 2, getKey, order: 'desc' });
    expect(page.items.map((r) => r.id)).toEqual(['e', 'd']);
    const second = paginateArray(items, {
      cursor: page.nextCursor,
      limit: 2,
      getKey,
      order: 'desc',
    });
    expect(second.items.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('is stable when timestamps collide', () => {
    const sameTs = [row('z', 1000), row('m', 1000), row('a', 1000)];
    const page = paginateArray(sameTs, { limit: 2, getKey, order: 'asc' });
    // id ASC tie-break: a, m then z
    expect(page.items.map((r) => r.id)).toEqual(['a', 'm']);
    const rest = paginateArray(sameTs, { cursor: page.nextCursor, limit: 2, getKey });
    expect(rest.items.map((r) => r.id)).toEqual(['z']);
  });
});

describe('buildPageFromOverfetch', () => {
  it('slices limit+1 rows into a page', () => {
    const rows = [row('a', 1), row('b', 2), row('c', 3)];
    const page = buildPageFromOverfetch(rows, 2, getKey);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor)).toEqual(getKey(rows[1]));
  });
});

describe('toPaginationMeta / parseCursorQuery', () => {
  it('projects meta fields', () => {
    expect(
      toPaginationMeta({ limit: 10, nextCursor: 'c', hasMore: true }),
    ).toEqual({ limit: 10, nextCursor: 'c', hasMore: true });
  });

  it('detects cursor mode from query presence', () => {
    expect(parseCursorQuery({ cursor: '', limit: '5' })).toMatchObject({
      cursorMode: true,
      cursor: undefined,
      limit: 5,
    });
    expect(parseCursorQuery({ limit: '5' }).cursorMode).toBe(false);
  });
});

describe('compareCursorKeysAsc', () => {
  it('orders by t then i', () => {
    expect(compareCursorKeysAsc({ t: 1, i: 'a' }, { t: 2, i: 'a' })).toBeLessThan(0);
    expect(compareCursorKeysAsc({ t: 1, i: 'a' }, { t: 1, i: 'b' })).toBeLessThan(0);
  });
});
