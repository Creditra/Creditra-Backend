import express from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'creditra-backend' });
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

// ── Global error handling ────────────────────────────────────────────
app.use(notFoundHandler); // catch unmatched routes → 404
app.use(errorHandler);    // centralised error serialisation

// ── Export for testing ───────────────────────────────────────────────
export { app };

app.listen(port, () => {
  console.log(`Creditra API listening on http://localhost:${port}`);
});
