import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'yaml';
import swaggerUi from 'swagger-ui-express';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimiter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiSpec = yaml.parse(readFileSync(join(__dirname, 'openapi.yaml'), 'utf8'));

export const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.get('/docs.json', (_req, res) => res.json(openapiSpec));

app.use('/api/risk/evaluate', createRateLimiter());
app.use('/api/credit/lines', createRateLimiter());
app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

app.use(errorHandler);

export default app;

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Creditra API listening on http://localhost:${port}`);
    console.log(`Swagger UI available at  http://localhost:${port}/docs`);
  });
}
