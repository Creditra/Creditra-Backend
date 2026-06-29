import type { Request, Response, NextFunction } from 'express';

/**
 * In-memory maintenance mode state.
 * In production this could be backed by a DB flag or Redis key,
 * but for a single-instance deployment in-memory is sufficient.
 */
let _maintenanceMode = false;
const _auditLog: Array<{ at: string; enabled: boolean; by: string }> = [];

/** Read-only methods that are always allowed even in maintenance mode. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths that are always allowed regardless of maintenance mode (e.g. admin toggle). */
const EXEMPT_PATH_PREFIXES = ['/api/admin/'];

export function isMaintenanceModeEnabled(): boolean {
    return _maintenanceMode;
}

export function setMaintenanceMode(enabled: boolean, actor: string): void {
    _maintenanceMode = enabled;
    _auditLog.push({ at: new Date().toISOString(), enabled, by: actor });
}

export function getAuditLog(): Array<{ at: string; enabled: boolean; by: string }> {
    return [..._auditLog];
}

/**
 * Express middleware that blocks non-read requests when maintenance mode is active.
 * Health-check and OPTIONS routes are always permitted.
 */
export function maintenanceModeGuard(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    if (!_maintenanceMode) {
        next();
        return;
    }

    // Always allow health checks, safe HTTP methods, and admin paths.
    if (
        req.path === '/health' ||
        SAFE_METHODS.has(req.method) ||
        EXEMPT_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix))
    ) {
        next();
        return;
    }

    res.status(503).json({
        error: 'Service Unavailable',
        message: 'The API is currently in maintenance mode (read-only). Please retry later.',
        maintenanceMode: true,
    });
}
