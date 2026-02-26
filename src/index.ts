import express from 'express';
import cors from 'cors';
import creditRouter from './routes/credit.js';
import riskRouter from './routes/risk.js';

export const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'creditra-backend' });
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

// Only bind to a port when this file is run directly – not during tests.
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Creditra API listening on http://localhost:${port}`);
  });
}
