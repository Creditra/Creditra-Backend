import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'yaml';
import swaggerUi from 'swagger-ui-express';

import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { ok } from './utils/response.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiSpec = yaml.parse(
  readFileSync(join(__dirname, 'openapi.yaml'), 'utf8')
);

const app = express();
export const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

// ── Docs ────────────────────────────────────────────────────────────────────
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
app.get('/docs.json', (_req, res) => res.json(openapiSpec));

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  ok(res, { status: 'ok', service: 'creditra-backend' });
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

app.listen(port, () => {
  console.log(`Creditra API listening on http://localhost:${port}`);
  console.log(`Swagger UI available at  http://localhost:${port}/docs`);
});

export { app };  // exported for tests
// Only start the server if not imported by tests setup
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Creditra API listening on http://localhost:${port}`);
  });
}
