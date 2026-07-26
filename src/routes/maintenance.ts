import { Router } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import {
    isMaintenanceModeEnabled,
    setMaintenanceMode,
    getAuditLog,
} from '../middleware/maintenanceMode.js';
import { defaultAdminAuditLog } from '../services/adminAuditLog.js';
import { adminActorFromRequest } from '../utils/adminActor.js';

export const maintenanceRouter = Router();

/**
 * GET /api/admin/maintenance
 * Returns the current maintenance mode status and audit log.
 * Requires admin authentication.
 */
maintenanceRouter.get('/', adminAuth, (_req, res) => {
    res.json({
        maintenanceMode: isMaintenanceModeEnabled(),
        auditLog: getAuditLog(),
    });
});

/**
 * POST /api/admin/maintenance
 * Body: { "enabled": true | false }
 * Toggles maintenance mode on or off.
 * Requires admin authentication.
 */
maintenanceRouter.post('/', adminAuth, (req, res) => {
    const { enabled } = req.body as { enabled?: unknown };

    if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Bad Request', message: '"enabled" must be a boolean.' });
        return;
    }

    const actor =
        (Array.isArray(req.headers['x-admin-api-key'])
            ? req.headers['x-admin-api-key'][0]
            : req.headers['x-admin-api-key']) ?? 'unknown';

    const before = { enabled: isMaintenanceModeEnabled() };
    setMaintenanceMode(enabled, actor);
    defaultAdminAuditLog.record({
        actor: adminActorFromRequest(req),
        action: 'maintenance_mode.updated',
        target: { type: 'maintenance_mode' },
        before,
        after: { enabled: isMaintenanceModeEnabled() },
    });

    res.json({
        maintenanceMode: isMaintenanceModeEnabled(),
        message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}.`,
    });
});
