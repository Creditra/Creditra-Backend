import request from 'supertest';
import express from 'express';
import { creditRouter } from '../routes/credit.js';
import { paginateAndFilter } from '../utils/paginate.js';
import { creditLines } from '../data/creditLines.js';

import { Container } from '../container/Container.js';
import { CreditLineStatus } from '../models/CreditLine.js';

const app = express();
app.use(express.json());
app.use('/api/credit', creditRouter);

beforeAll(async () => {
    const container = Container.getInstance();
    const repo = (container.creditLineService as any).creditLineRepository;
    repo.clear();
    for (const raw of creditLines) {
        repo.creditLines.set(raw.id, {
            id: raw.id,
            walletAddress: raw.borrower,
            creditLimit: raw.creditLimit,
            availableCredit: raw.creditLimit,
            interestRateBps: raw.interestRateBps,
            status: raw.status as CreditLineStatus,
            createdAt: new Date(raw.createdAt),
            updatedAt: new Date(raw.createdAt)
        });
    }
});

describe('GET /api/credit/lines - pagination', () => {
  it('returns all items with default pagination', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(10);
    expect(res.body.total).toBe(8);
    expect(res.body.items).toHaveLength(8);
  });

  it('returns correct items for page 1 with pageSize 3', async () => {
    const res = await request(app).get('/api/credit/lines?page=1&pageSize=3');
    expect(res.body.items).toHaveLength(3);
    expect(res.body.total).toBe(8);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(3);
  });

  it('returns correct items for page 2 with pageSize 3', async () => {
    const res = await request(app).get('/api/credit/lines?page=2&pageSize=3');
    expect(res.body.items).toHaveLength(3);
    expect(res.body.page).toBe(2);
  });

  it('returns empty items for out of range page', async () => {
    const res = await request(app).get('/api/credit/lines?page=100&pageSize=10');
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(8);
  });

  it('clamps pageSize to 100 max', async () => {
    const res = await request(app).get('/api/credit/lines?pageSize=999');
    expect(res.body.pageSize).toBe(100);
  });

  it('clamps page to 1 minimum', async () => {
    const res = await request(app).get('/api/credit/lines?page=-5');
    expect(res.body.page).toBe(1);
  });
});

describe('GET /api/credit/lines - filtering', () => {
  it('filters by status active', async () => {
    const res = await request(app).get('/api/credit/lines?status=active');
    expect(res.body.items.every((i: any) => i.status === 'active')).toBe(true);
    expect(res.body.total).toBe(4);
  });

  it('filters by status pending', async () => {
    const res = await request(app).get('/api/credit/lines?status=pending');
    expect(res.body.items.every((i: any) => i.status === 'pending')).toBe(true);
    expect(res.body.total).toBe(2);
  });

  it('filters by status closed', async () => {
    const res = await request(app).get('/api/credit/lines?status=closed');
    expect(res.body.total).toBe(1);
  });

  it('filters by status defaulted', async () => {
    const res = await request(app).get('/api/credit/lines?status=defaulted');
    expect(res.body.total).toBe(1);
  });

  it('filters by borrower exact match', async () => {
    const res = await request(app).get('/api/credit/lines?borrower=wallet_aaa');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].walletAddress).toBe('wallet_aaa');
  });

  it('filters by borrower partial match', async () => {
    const res = await request(app).get('/api/credit/lines?borrower=wallet');
    expect(res.body.total).toBe(8);
  });

  it('returns empty for non-existent borrower', async () => {
    const res = await request(app).get('/api/credit/lines?borrower=nobody');
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it('combines status and borrower filters', async () => {
    const res = await request(app).get('/api/credit/lines?status=active&borrower=wallet_aaa');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].status).toBe('active');
  });
});

describe('GET /api/credit/lines - sorting', () => {
  it('sorts by creditLimit descending', async () => {
    const res = await request(app).get('/api/credit/lines?sortBy=creditLimit&sortDirection=desc');
    const limits = res.body.items.map((i: any) => i.creditLimit);
    expect(limits[0]).toBe('8000');
  });

  it('sorts by creditLimit ascending', async () => {
    const res = await request(app).get('/api/credit/lines?sortBy=creditLimit&sortDirection=asc');
    const limits = res.body.items.map((i: any) => i.creditLimit);
    expect(limits[0]).toBe('1000');
  });

  it('sorts by createdAt ascending by default', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(new Date(res.body.items[0].createdAt).toISOString().startsWith('2024-01-01')).toBe(true);
  });

  it('defaults to asc for invalid sortDirection', async () => {
    const res = await request(app).get('/api/credit/lines?sortDirection=invalid');
    expect(new Date(res.body.items[0].createdAt).toISOString().startsWith('2024-01-01')).toBe(true);
  });
});

describe('GET /api/credit/lines/:id', () => {
  it('returns a credit line by id', async () => {
    const res = await request(app).get('/api/credit/lines/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');
    expect(res.body.walletAddress).toBe('wallet_aaa');
  });

  it('returns 404 for non-existent id', async () => {
    const res = await request(app).get('/api/credit/lines/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Credit line not found');
  });
});

describe('paginateAndFilter utility', () => {
  it('handles empty dataset', () => {
    const result = paginateAndFilter([], {});
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('handles invalid page gracefully', () => {
    const result = paginateAndFilter(creditLines, { page: 'abc' });
    expect(result.page).toBe(1);
  });

  it('handles invalid pageSize gracefully', () => {
    const result = paginateAndFilter(creditLines, { pageSize: 'abc' });
    expect(result.pageSize).toBe(10);
  });
});

describe('paginateAndFilter utility - branch coverage', () => {
  it('handles equal values during sort (stable order)', () => {
    const result = paginateAndFilter(creditLines, { sortBy: 'status', sortDirection: 'asc' });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('handles missing sortBy field gracefully', () => {
    const result = paginateAndFilter(creditLines, { sortBy: 'nonExistentField' });
    expect(result.items).toHaveLength(8);
  });

  it('handles pageSize of 1', () => {
    const result = paginateAndFilter(creditLines, { pageSize: '1' });
    expect(result.items).toHaveLength(1);
    expect(result.pageSize).toBe(1);
  });
});
