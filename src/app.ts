import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { metricsRouter, recordRequest } from './routes/metrics.js';

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

  app.use('/api/credit', creditRouter);
  app.use('/api/risk', riskRouter);

  // Internal metrics endpoint — requires METRICS_TOKEN bearer auth.
  app.use('/api/metrics', metricsRouter);

  return app;
}
