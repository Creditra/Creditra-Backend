import express from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'creditra-backend' });
  });

  app.use('/api/credit', creditRouter);
  app.use('/api/risk', riskRouter);

  return app;
}
