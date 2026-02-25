import express from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';

export const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'creditra-backend' });
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

// Only start listening when this file is the entry-point (not when imported by tests).
/* istanbul ignore next */
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Creditra API listening on http://localhost:${port}`);
  });
}
