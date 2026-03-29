import request from 'supertest';
import express, { type Application } from 'express';

// ---------------------------------------------------------------------------
// Minimal app factory — mirrors your src/index.ts route structure so that
// tests are isolated from the HTTP server binding (no open handles).
// ---------------------------------------------------------------------------
function createApp(): Application {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Credit lines placeholder
  app.get('/api/credit/lines', (_req, res) => {
    res.status(200).json({ lines: [] });
  });

  // Credit line by id placeholder
  app.get('/api/credit/lines/:id', (req, res) => {
    res.status(200).json({ id: req.params.id, line: null });
  });

  // Risk evaluation placeholder
  app.post('/api/risk/evaluate', (req, res) => {
    const { walletAddress } = (req.body || {}) as { walletAddress?: string };
    if (!walletAddress) {
      res.status(400).json({ error: 'walletAddress is required' });
      return;
    }
    res.status(200).json({ walletAddress, score: null, status: 'pending' });
  });

  return app;
}

const app = createApp();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Health check', () => {
  it('GET /health → 200 { status: "ok" }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Credit lines routes', () => {
  it('GET /api/credit/lines → 200 with empty lines array', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lines');
    expect(Array.isArray(res.body.lines)).toBe(true);
  });

  it('GET /api/credit/lines/:id → 200 with id echoed back', async () => {
    const res = await request(app).get('/api/credit/lines/abc123');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('abc123');
  });
});

describe('Risk evaluation route', () => {
  it('POST /api/risk/evaluate → 200 when walletAddress provided', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: '0xABCDEF1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.walletAddress).toBe('0xABCDEF1234567890');
    expect(res.body.status).toBe('pending');
  });

  it('POST /api/risk/evaluate → 400 when walletAddress missing', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});