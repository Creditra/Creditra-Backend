import express from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { apiKeysRouter } from './routes/apiKeys.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'creditra-backend' });
  });

  // Maintenance mode guard: blocks mutations (non-GET) when enabled.
  app.use(maintenanceModeGuard);

  app.use('/api/credit', creditRouter);
  app.use('/api/risk', riskRouter);
  app.use('/api/admin/api-keys', apiKeysRouter);

  // Admin-only route to toggle maintenance mode.
  app.use('/api/admin/maintenance', maintenanceRouter);

  return app;
}
