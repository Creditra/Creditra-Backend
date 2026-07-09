import type { Request } from 'express';
import { ADMIN_KEY_HEADER } from '../middleware/adminAuth.js';
import { actorFingerprint } from '../services/adminAuditLog.js';

export function adminActorFromRequest(req: Request): string {
  const header = req.headers[ADMIN_KEY_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  return raw ? actorFingerprint(raw) : 'unknown';
}
