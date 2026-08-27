/** Opaque, versioned cursor used by stable list traversals. */
export interface CreditLineCursor {
  version: 1;
  /** Last row's created-at timestamp in milliseconds. */
  createdAt: number;
  /** Last row's unique id, used as the tie-breaker. */
  id: string;
  /** Upper bound captured by the first page request. */
  snapshotAt: number;
}

export function encodeCreditLineCursor(cursor: CreditLineCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCreditLineCursor(value: string): CreditLineCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const cursor = parsed as Partial<CreditLineCursor>;
    if (
      cursor.version !== 1 ||
      typeof cursor.createdAt !== 'number' || !Number.isFinite(cursor.createdAt) ||
      typeof cursor.snapshotAt !== 'number' || !Number.isFinite(cursor.snapshotAt) ||
      typeof cursor.id !== 'string' || cursor.id.length === 0
    ) return null;
    return cursor as CreditLineCursor;
  } catch {
    return null;
  }
}

export interface TransactionCursor {
  version: 1;
  timestamp: number;
  id: string;
  snapshotAt: number;
}

export function encodeTransactionCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeTransactionCursor(value: string): TransactionCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const cursor = parsed as Partial<TransactionCursor>;
    if (
      cursor.version !== 1 ||
      typeof cursor.timestamp !== 'number' || !Number.isFinite(cursor.timestamp) ||
      typeof cursor.snapshotAt !== 'number' || !Number.isFinite(cursor.snapshotAt) ||
      typeof cursor.id !== 'string' || cursor.id.length === 0
    ) return null;
    return cursor as TransactionCursor;
  } catch {
    return null;
  }
}
