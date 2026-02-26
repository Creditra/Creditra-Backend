import express from 'express';
import cors from 'cors';
import { creditRouter } from './routes/credit.js';
import { riskRouter } from './routes/risk.js';
import { correlationMiddleware } from './middleware/correlation.js';
import { requestLoggingMiddleware } from './middleware/logging.js';
import { errorHandlerMiddleware } from './middleware/errorHandler.js';
import { logger } from './logger.js';

const app = express();
const port = process.env.PORT ?? 3000;

// Correlation ID must be first to ensure all logs have it
app.use(correlationMiddleware);

app.use(cors());
app.use(express.json());

// Request logging after body parsing
app.use(requestLoggingMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'creditra-backend' });
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);

// Error handler must be last
app.use(errorHandlerMiddleware);

app.listen(port, () => {
  logger.info('Server started', { port, service: 'creditra-backend' });
});
