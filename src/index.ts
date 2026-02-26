import express from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { healthRouter } from './routes/health.js';

const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

app.listen(port, () => {
  console.log(`Creditra API listening on http://localhost:${port}`);
});
