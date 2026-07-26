/**
 * Shared cursor-based pagination helpers.
 *
 * Standard model for every list endpoint:
 * - Opaque cursors (base64url JSON; clients must treat them as black boxes)
 * - Deterministic sort key: `(timestamp ms, id)` with stable ASC or DESC order
 * - Response shape: `{ items, nextCursor, hasMore, limit }`
 *
 * Repositories may implement the same key comparison in SQL; encode/decode
 * and in-memory page building live here so routes never invent their own
 * cursor format.
 *
 * @see docs/cursor-pagination.md
 */
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
} from './constants.js';

/** Version tag embedded in every minted cursor. Bump only on breaking format changes. */
export const CURSOR_VERSION = 1 as const;

/**
 * Sort key material encoded into a cursor.
 * `t` is the primary sort column (usually createdAt epoch-ms);
 * `i` is a unique tie-breaker (usually the row id).
 */
export interface CursorKey {
  readonly t: number;
  readonly i: string;
}

/** Standard cursor-page payload returned by repositories and services. */
export interface CursorPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly limit: number;
}

/** Pagination meta block attached to HTTP list responses. */
export interface CursorPaginationMeta {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Alias kept for repository interfaces that historically used this name. */
export type CursorPaginationResult<T = unknown> = Omit<CursorPage<T>, 'limit'> & {
  limit?: number;
};

export type CursorSortOrder = 'asc' | 'desc';

/**
 * Thrown when a client-supplied cursor cannot be decoded.
 * Routes map this to HTTP 400 when strict mode is requested.
 */
export class InvalidCursorError extends Error {
  public readonly code = 'invalid_cursor';

  constructor(message = 'Invalid cursor') {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

/**
 * Clamp / default a page `limit` to the shared bounds.
 *
 * @throws {Error} when `limit` is present but non-finite, &lt; min, or &gt; max
 */
export function clampLimit(
  limit?: number,
  options: {
    defaultLimit?: number;
    min?: number;
    max?: number;
  } = {},
): number {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const min = options.min ?? MIN_PAGE_SIZE;
  const max = options.max ?? MAX_PAGE_SIZE;

  if (limit === undefined || limit === null || (typeof limit === 'number' && Number.isNaN(limit))) {
    return defaultLimit;
  }
  if (!Number.isFinite(limit) || !Number.isInteger(limit)) {
    throw new Error(`Limit must be an integer between ${min} and ${max}`);
  }
  if (limit < min) {
    throw new Error(min === 1 ? 'Limit must be greater than 0' : `Limit must be at least ${min}`);
  }
  if (limit > max) {
    throw new Error(`Limit cannot exceed ${max}`);
  }
  return limit;
}

/** Encode a cursor key as an opaque base64url string. */
export function encodeCursor(key: CursorKey): string {
  if (!Number.isFinite(key.t) || typeof key.i !== 'string' || key.i.length === 0) {
    throw new Error('Cannot encode cursor: invalid key');
  }
  const payload = JSON.stringify({ v: CURSOR_VERSION, t: key.t, i: key.i });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor.
 *
 * Accepts the current base64url JSON format and the legacy
 * `base64(timestamp|id)` format used by early credit-line pagination so
 * in-flight clients are not broken mid-rollout.
 *
 * @param cursor - raw query value
 * @param options.strict - when true, throw {@link InvalidCursorError} on bad input;
 *   when false (default), return `null` so callers can fall back to page 1
 */
export function decodeCursor(
  cursor: string | undefined | null,
  options: { strict?: boolean } = {},
): CursorKey | null {
  const strict = options.strict === true;

  if (cursor === undefined || cursor === null || cursor === '') {
    return null;
  }
  if (typeof cursor !== 'string') {
    if (strict) throw new InvalidCursorError('Cursor must be a string');
    return null;
  }

  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');

    // Preferred format: versioned JSON.
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { v?: unknown; t?: unknown; i?: unknown };
      if (parsed.v !== CURSOR_VERSION) {
        if (strict) throw new InvalidCursorError('Unsupported cursor version');
        return null;
      }
      if (typeof parsed.t !== 'number' || !Number.isFinite(parsed.t) || typeof parsed.i !== 'string' || !parsed.i) {
        if (strict) throw new InvalidCursorError('Malformed cursor payload');
        return null;
      }
      return { t: parsed.t, i: parsed.i };
    }

    // Legacy format: "timestamp|id" (standard base64, not url-safe).
    const legacyRaw = Buffer.from(cursor, 'base64').toString('utf8');
    const pipe = legacyRaw.indexOf('|');
    if (pipe > 0) {
      const t = Number(legacyRaw.slice(0, pipe));
      const i = legacyRaw.slice(pipe + 1);
      if (Number.isFinite(t) && i.length > 0) {
        return { t, i };
      }
    }
  } catch (err) {
    if (err instanceof InvalidCursorError) throw err;
    if (strict) throw new InvalidCursorError('Malformed cursor');
    return null;
  }

  if (strict) throw new InvalidCursorError('Malformed cursor');
  return null;
}

/** Compare two cursor keys for ASC ordering (t, then i). */
export function compareCursorKeysAsc(a: CursorKey, b: CursorKey): number {
  if (a.t !== b.t) return a.t - b.t;
  return a.i.localeCompare(b.i);
}

/** Compare two cursor keys for DESC ordering (t, then i ascending as stable tie-break). */
export function compareCursorKeysDesc(a: CursorKey, b: CursorKey): number {
  if (a.t !== b.t) return b.t - a.t;
  return a.i.localeCompare(b.i);
}

/**
 * True when `item` sorts strictly after `cursor` in the given order
 * (i.e. belongs on a subsequent page).
 */
export function isAfterCursor(
  item: CursorKey,
  cursor: CursorKey,
  order: CursorSortOrder = 'asc',
): boolean {
  if (order === 'asc') {
    return compareCursorKeysAsc(item, cursor) > 0;
  }
  // DESC: "after" means smaller timestamp (older) or equal t with greater id
  if (item.t !== cursor.t) return item.t < cursor.t;
  return item.i.localeCompare(cursor.i) > 0;
}

/**
 * Build a page from a fully sorted array already filtered to the page window.
 * Callers that fetched `limit + 1` rows should pass that oversize slice here.
 */
export function buildPageFromOverfetch<T>(
  overfetched: T[],
  limit: number,
  getKey: (item: T) => CursorKey,
): CursorPage<T> {
  const hasMore = overfetched.length > limit;
  const items = hasMore ? overfetched.slice(0, limit) : overfetched;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last !== undefined ? encodeCursor(getKey(last)) : null;
  return { items, nextCursor, hasMore, limit };
}

/**
 * In-memory cursor pagination over a pre-sorted array (or an unsorted array
 * when `sort` is provided). Used by in-memory repositories and list endpoints
 * that hold the full collection in process.
 */
export function paginateArray<T>(
  items: readonly T[],
  options: {
    cursor?: string | null;
    limit?: number;
    getKey: (item: T) => CursorKey;
    order?: CursorSortOrder;
    /** When true, invalid cursors throw; otherwise start from the beginning. */
    strictCursor?: boolean;
    defaultLimit?: number;
  },
): CursorPage<T> {
  const order = options.order ?? 'asc';
  const limit = clampLimit(options.limit, { defaultLimit: options.defaultLimit });
  const getKey = options.getKey;

  const sorted = [...items].sort((a, b) =>
    order === 'asc' ? compareCursorKeysAsc(getKey(a), getKey(b)) : compareCursorKeysDesc(getKey(a), getKey(b)),
  );

  const decoded = decodeCursor(options.cursor, { strict: options.strictCursor === true });

  let startIndex = 0;
  if (decoded) {
    // Prefer the classic "resume after the exact key" scan so pages never
    // re-emit the cursor item even if timestamps collide.
    const exact = sorted.findIndex((item) => {
      const k = getKey(item);
      return k.t === decoded.t && k.i === decoded.i;
    });
    if (exact >= 0) {
      startIndex = exact + 1;
    } else {
      startIndex = sorted.findIndex((item) => isAfterCursor(getKey(item), decoded, order));
      if (startIndex < 0) startIndex = sorted.length;
    }
  }

  const window = sorted.slice(startIndex, startIndex + limit + 1);
  return buildPageFromOverfetch(window, limit, getKey);
}

/** Build the standard HTTP pagination meta block from a {@link CursorPage}. */
export function toPaginationMeta(page: Pick<CursorPage<unknown>, 'limit' | 'nextCursor' | 'hasMore'>): CursorPaginationMeta {
  return {
    limit: page.limit,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

/**
 * Parse `cursor` / `limit` from a loose query object (Express `req.query`).
 * Empty-string cursor means "first page, cursor mode engaged".
 */
export function parseCursorQuery(
  query: Record<string, unknown>,
  options: { defaultLimit?: number } = {},
): { cursor: string | undefined; limit: number; cursorMode: boolean } {
  const cursorMode = Object.prototype.hasOwnProperty.call(query, 'cursor');
  const rawCursor = query.cursor;
  const cursor =
    typeof rawCursor === 'string' && rawCursor.length > 0 ? rawCursor : undefined;

  let rawLimit: number | undefined;
  if (query.limit !== undefined && query.limit !== '') {
    rawLimit = typeof query.limit === 'number' ? query.limit : Number.parseInt(String(query.limit), 10);
  }

  const limit = clampLimit(rawLimit, {
    defaultLimit: options.defaultLimit ?? DEFAULT_PAGE_SIZE,
  });

  return { cursor, limit, cursorMode };
}

/**
 * SQL helper: bind parameters for an ASC `(created_at, id)` seek.
 * Returns `{ clause, values }` where `clause` is empty when there is no cursor.
 *
 * Example:
 * ```sql
 * WHERE (created_at > $2 OR (created_at = $2 AND id > $3))
 * ORDER BY created_at ASC, id ASC
 * LIMIT $1
 * ```
 */
export function sqlSeekAsc(
  cursor: CursorKey | null,
  limit: number,
  startIndex = 1,
): { limitParam: number; clause: string; values: unknown[] } {
  const limitParam = startIndex;
  if (!cursor) {
    return { limitParam, clause: '', values: [limit + 1] };
  }
  const tParam = startIndex + 1;
  const iParam = startIndex + 2;
  return {
    limitParam,
    clause: `(created_at > $${tParam} OR (created_at = $${tParam} AND id > $${iParam}))`,
    values: [limit + 1, new Date(cursor.t), cursor.i],
  };
}
