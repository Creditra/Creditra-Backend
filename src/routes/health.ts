import { Router } from 'express';
import { getConnection } from '../db/client.js';
import { resolveConfig } from '../services/horizonListener.js';

export const healthRouter = Router();

healthRouter.get('/live', (_req, res) => {
     res.status(200).json({
          status: 'ok',
          service: 'creditra-backend',
     });
});

healthRouter.get('/', async (_req, res) => {
     let database: 'up' | 'down' = 'up';
     let horizon: 'up' | 'down' = 'up';

     try {
          const db = getConnection();
          if (db.connect) await db.connect();
          await db.query('SELECT 1');
          await db.end();
     } catch (err) {
          database = 'down';
     }

     try {
          const config = resolveConfig();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(config.horizonUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) {
               horizon = 'down';
          }
     } catch (err) {
          horizon = 'down';
     }

     const isReady = database === 'up' && horizon === 'up';

     res.status(isReady ? 200 : 503).json({
          status: isReady ? 'ok' : 'error',
          service: 'creditra-backend',
          dependencies: { database, horizon },
     });
});