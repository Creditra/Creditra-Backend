/**
 * Capture the exact request bytes during JSON body parsing so HMAC
 * verification can run against the wire body (not a re-serialized object).
 */
import type { Request } from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * body-parser `verify` hook: stash a copy of the raw buffer on the request.
 */
export function captureRawBody(req: Request, _res: unknown, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = Buffer.from(buf);
}

export function getRawBody(req: Request): Buffer | undefined {
  return (req as RawBodyRequest).rawBody;
}
