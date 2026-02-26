import express from 'express';
import cors from 'cors';
import creditRouter from './routes/credit.js';
import riskRouter from './routes/risk.js';
import { config } from './config/index.js';

const app = express();
const port = config.port;


app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'creditra-backend' });
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);


app.listen(port, () => {
  console.log(`Creditra API listening on http://localhost:${port}`);
});

