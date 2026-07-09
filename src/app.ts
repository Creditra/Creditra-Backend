import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { metricsRouter, recordRequest } from './routes/metrics.js';
import { reconciliationRouter } from './routes/reconciliation.js';
import { webhookRouter } from './routes/webhook.js';
import { dashboardRouter } from './routes/dashboard.js';
import { maintenanceModeGuard } from './middleware/maintenanceMode.js';

/**
 * Application factory used by integration tests and lightweight local boots.
 *
 * Mounts the full HTTP surface (including admin/metrics routes that are
 * also wired independently in production entrypoints) so auth-boundary
 * suites can exercise every sensitive path through a single Express app.
 */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Middleware: capture request duration and error status for metrics aggregation.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      recordRequest(Date.now() - start, res.statusCode >= 500);
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'creditra-backend' });
  });

  // Maintenance mode guard: blocks mutations (non-GET) when enabled.
  app.use(maintenanceModeGuard);

  app.use('/api/credit', creditRouter);
  app.use('/api/risk', riskRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reconciliation', reconciliationRouter);
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/admin/api-keys', apiKeysRouter);

  // Admin-only route to toggle maintenance mode.
  app.use('/api/admin/maintenance', maintenanceRouter);

  // Internal metrics endpoint — requires METRICS_TOKEN bearer auth.
  app.use('/api/metrics', metricsRouter);

  return app;
}
