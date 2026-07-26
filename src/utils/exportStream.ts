/**
 * Streaming helpers for compliance exports (CSV / JSON).
 *
 * Writes rows incrementally via `res.write` so large exports never materialise
 * a full payload string in memory. Callers still must enforce export row
 * ceilings before iterating.
 */
import type { Response } from 'express';

export type ExportFormat = 'csv' | 'json';

export interface StreamMeta {
  resource: string;
  format: ExportFormat;
  count: number;
  limit: number;
  offset: number;
  truncated: boolean;
  from: string;
  to: string;
  generatedAt: string;
}

/** Escape a single CSV field (RFC 4180). */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Stream rows as CSV. Headers are derived from `columns` in order.
 * Sets `Content-Type` and `Content-Disposition` before writing.
 */
export function streamCsv(
  res: Response,
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  filename: string,
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  res.write(`${columns.map(escapeCsvField).join(',')}\n`);
  for (const row of rows) {
    const line = columns.map((col) => escapeCsvField(row[col])).join(',');
    res.write(`${line}\n`);
  }
  res.end();
}

/**
 * Stream rows as a JSON envelope with incremental array writes.
 *
 * Shape:
 * ```json
 * { "data": [ ...rows ], "meta": { ... }, "error": null }
 * ```
 */
export function streamJson(
  res: Response,
  rows: ReadonlyArray<Record<string, unknown>>,
  meta: StreamMeta,
): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  res.write('{"data":[');
  rows.forEach((row, index) => {
    if (index > 0) res.write(',');
    res.write(JSON.stringify(row));
  });
  res.write('],"meta":');
  res.write(JSON.stringify(meta));
  res.write(',"error":null}');
  res.end();
}

/** Flatten nested objects for CSV (JSON-stringify object/array values). */
export function flattenForExport(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (value !== null && typeof value === 'object') {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
