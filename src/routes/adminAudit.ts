import { Router } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { defaultAdminAuditLog } from '../services/adminAuditLog.js';
import { ok, fail } from '../utils/response.js';

export const adminAuditRouter = Router();

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

adminAuditRouter.get('/', adminAuth, (req, res) => {
  const limit = parseLimit(req.query.limit);
  if (req.query.limit !== undefined && (limit === undefined || limit < 1 || limit > 100)) {
    fail(res, 'limit must be an integer between 1 and 100', 400);
    return;
  }

  ok(res, defaultAdminAuditLog.list({
    limit,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    targetType: typeof req.query.targetType === 'string' ? req.query.targetType : undefined,
  }));
});
