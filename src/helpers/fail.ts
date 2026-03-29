import type { Response } from 'express';

export type ErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR';

/**
 * Sends a consistent JSON error response.
 * Use this for ALL error responses — never use raw res.json() for errors.
 */
export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
): void {
  res.status(status).json({ error: { code, message } });
}
