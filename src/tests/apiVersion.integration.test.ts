import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { DEFAULT_LEGACY_SUNSET } from '../config/apiVersion.js';

describe('API versioning — /api/v1/* (canonical)', () => {
  it('GET /api/v1/credit/lines returns 200 and X-API-Version without Deprecation', async () => {
    const res = await request(app).get('/api/v1/credit/lines');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('creditLines');
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.headers['deprecation']).toBeUndefined();
    expect(res.headers['sunset']).toBeUndefined();
  });

  it('POST /api/v1/risk/evaluate is mounted and versioned', async () => {
    const res = await request(app)
      .post('/api/v1/risk/evaluate')
      .send({ walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });

    expect(res.status).toBe(200);
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.headers['deprecation']).toBeUndefined();
    expect(res.body.data).toHaveProperty('riskScore');
  });

  it('GET /api/v1/reconciliation/status is mounted (auth still enforced)', async () => {
    const res = await request(app).get('/api/v1/reconciliation/status');
    expect(res.status).toBe(401);
    expect(res.headers['x-api-version']).toBe('1');
  });

  it('GET /api/v1/credit/lines/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/v1/credit/lines/nonexistent');
    expect(res.status).toBe(404);
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.body).toEqual({ data: null, error: 'Credit line not found' });
  });
});

describe('API versioning — legacy /api/* (deprecated, compatible)', () => {
  it('GET /api/credit/lines still works with deprecation headers', async () => {
    const res = await request(app).get('/api/credit/lines');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('creditLines');
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe(DEFAULT_LEGACY_SUNSET);
    expect(res.headers['link']).toBe(
      '</api/v1/credit/lines>; rel="successor-version"',
    );
  });

  it('POST /api/risk/evaluate remains available under legacy path', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({});

    expect(res.status).toBe(400);
    expect(res.headers['x-api-version']).toBe('1');
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['link']).toContain('/api/v1/risk/evaluate');
    expect(res.headers['link']).toContain('rel="successor-version"');
  });

  it('maps successor Link for nested legacy paths', async () => {
    const res = await request(app).get(
      '/api/credit/lines/nonexistent',
    );
    expect(res.status).toBe(404);
    expect(res.headers['link']).toBe(
      '</api/v1/credit/lines/nonexistent>; rel="successor-version"',
    );
  });
});

describe('API versioning — non-API routes', () => {
  it('GET /health does not send version or deprecation headers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-api-version']).toBeUndefined();
    expect(res.headers['deprecation']).toBeUndefined();
    expect(res.headers['sunset']).toBeUndefined();
  });
});

describe('OpenAPI reflects versioned paths', () => {
  it('documents /api/v1/* and not unversioned business paths', async () => {
    const res = await request(app).get('/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.info.version).toBe('1.0.0');
    expect(res.body.paths).toHaveProperty('/api/v1/credit/lines');
    expect(res.body.paths).toHaveProperty('/api/v1/risk/evaluate');
    expect(res.body.paths).toHaveProperty('/api/v1/reconciliation/trigger');
    expect(res.body.paths).toHaveProperty('/api/v1/reconciliation/status');
    expect(res.body.paths).not.toHaveProperty('/api/credit/lines');
    expect(res.body.paths).not.toHaveProperty('/api/reconciliation/trigger');
    // Health remains unversioned in the spec.
    expect(res.body.paths).toHaveProperty('/health');
  });
});
