import type { Request } from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function captureRawBody(req: Request, _res: unknown, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = Buffer.from(buf);
}

export function getRawBody(req: Request): Buffer | undefined {
  return (req as RawBodyRequest).rawBody;
}
