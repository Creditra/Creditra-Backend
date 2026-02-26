import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCreditRouter } from './credit.js';
import { ICreditLineRepository } from '../repositories/creditLineRepository.js';
import { CreditLine, CreditLineStatus } from '../models/creditLine.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildApp(repo: ICreditLineRepository) {
  const app = express();
  app.use(express.json());
  app.use('/api/credit', createCreditRouter(repo));
  return app;
}

const MOCK_LINES: CreditLine[] = [
  {
    id: 'route-test-id-001',
    borrowerId: 'borrower-001',
    limitCents: 50_000_00,
    utilizedCents: 5_000_00,
    interestRateBps: 1250,
    riskScore: 0.15,
    status: CreditLineStatus.Active,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-03-01T00:00:00.000Z'),
  },
  {
    id: 'route-test-id-002',
    borrowerId: 'borrower-002',
    limitCents: 20_000_00,
    utilizedCents: 20_000_00,
    interestRateBps: 1875,
    riskScore: 0.65,
    status: CreditLineStatus.Suspended,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-04-01T00:00:00.000Z'),
  },
];

// ── GET /api/credit/lines ─────────────────────────────────────────────────────

describe('GET /api/credit/lines', () => {
  let mockRepo: ICreditLineRepository;

  beforeEach(() => {
    mockRepo = {
      findAll: vi.fn().mockResolvedValue(MOCK_LINES),
      findById: vi.fn(),
    };
  });

  it('responds with HTTP 200', async () => {
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(res.status).toBe(200);
  });

  it('returns a JSON body with a creditLines array', async () => {
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(res.body).toHaveProperty('creditLines');
    expect(Array.isArray(res.body.creditLines)).toBe(true);
  });

  it('returns the correct number of credit lines', async () => {
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(res.body.creditLines).toHaveLength(2);
  });

  it('returns credit lines sorted newest-first by createdAt', async () => {
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    const ids: string[] = res.body.creditLines.map((cl: CreditLine) => cl.id);
    // route-test-id-002 has createdAt 2025-02-01 (newer) so it should come first
    expect(ids[0]).toBe('route-test-id-002');
    expect(ids[1]).toBe('route-test-id-001');
  });

  it('each credit line contains all required schema fields', async () => {
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    const cl = res.body.creditLines[0];
    expect(cl).toHaveProperty('id');
    expect(cl).toHaveProperty('borrowerId');
    expect(cl).toHaveProperty('limitCents');
    expect(cl).toHaveProperty('utilizedCents');
    expect(cl).toHaveProperty('interestRateBps');
    expect(cl).toHaveProperty('riskScore');
    expect(cl).toHaveProperty('status');
    expect(cl).toHaveProperty('createdAt');
    expect(cl).toHaveProperty('updatedAt');
  });

  it('calls the repository findAll once', async () => {
    await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when the repository is empty', async () => {
    mockRepo.findAll = vi.fn().mockResolvedValue([]);
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(res.status).toBe(200);
    expect(res.body.creditLines).toEqual([]);
  });

  it('returns HTTP 500 when the repository throws', async () => {
    mockRepo.findAll = vi.fn().mockRejectedValue(new Error('DB down'));
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('sets Content-Type to application/json', async () => {
    const res = await request(buildApp(mockRepo)).get('/api/credit/lines');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ── GET /api/credit/lines/:id ─────────────────────────────────────────────────

describe('GET /api/credit/lines/:id', () => {
  let mockRepo: ICreditLineRepository;

  beforeEach(() => {
    mockRepo = {
      findAll: vi.fn(),
      findById: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(MOCK_LINES.find((cl) => cl.id === id)),
      ),
    };
  });

  it('responds with HTTP 200 for a known id', async () => {
    const res = await request(buildApp(mockRepo)).get(
      '/api/credit/lines/route-test-id-001',
    );
    expect(res.status).toBe(200);
  });

  it('returns the correct credit line in a creditLine wrapper', async () => {
    const res = await request(buildApp(mockRepo)).get(
      '/api/credit/lines/route-test-id-001',
    );
    expect(res.body).toHaveProperty('creditLine');
    expect(res.body.creditLine.id).toBe('route-test-id-001');
  });

  it('returns HTTP 404 for an unknown id', async () => {
    const res = await request(buildApp(mockRepo)).get(
      '/api/credit/lines/does-not-exist',
    );
    expect(res.status).toBe(404);
  });

  it('404 body includes the requested id and an error message', async () => {
    const res = await request(buildApp(mockRepo)).get(
      '/api/credit/lines/does-not-exist',
    );
    expect(res.body).toHaveProperty('error');
    expect(res.body.id).toBe('does-not-exist');
  });

  it('calls findById with the correct id', async () => {
    await request(buildApp(mockRepo)).get(
      '/api/credit/lines/route-test-id-002',
    );
    expect(mockRepo.findById).toHaveBeenCalledWith('route-test-id-002');
  });

  it('returns HTTP 500 when the repository throws', async () => {
    mockRepo.findById = vi.fn().mockRejectedValue(new Error('DB error'));
    const res = await request(buildApp(mockRepo)).get(
      '/api/credit/lines/route-test-id-001',
    );
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('sets Content-Type to application/json', async () => {
    const res = await request(buildApp(mockRepo)).get(
      '/api/credit/lines/route-test-id-001',
    );
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});