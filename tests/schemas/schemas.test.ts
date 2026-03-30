import { describe, it, expect } from 'vitest';
import {
  riskEvaluateSchema,
  riskHistoryQuerySchema,
} from '../../src/schemas/risk.schema.js';
import {
  createCreditLineSchema,
  creditLinesQuerySchema,
  drawSchema,
  repaySchema,
  transactionHistoryQuerySchema,
} from '../../src/schemas/credit.schema.js';

/* ------------------------------------------------------------------ */
/*  riskEvaluateSchema                                                 */
/* ------------------------------------------------------------------ */
describe('riskEvaluateSchema', () => {
  it('accepts a valid walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1' });
    expect(result.success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: '' });
    expect(result.success).toBe(false);
  });

  it('rejects walletAddress exceeding 256 chars', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 'x'.repeat(257) });
    expect(result.success).toBe(false);
  });

  it('rejects non-string walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 123 });
    expect(result.success).toBe(false);
  });

  it('accepts optional forceRefresh', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1', forceRefresh: true });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1', extra: 'nope' });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  createCreditLineSchema                                             */
/* ------------------------------------------------------------------ */
describe('createCreditLineSchema', () => {
  it('accepts valid body', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
      requestedLimit: '1000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts decimal requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
      requestedLimit: '1000.50',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const result = createCreditLineSchema.safeParse({ requestedLimit: '100' });
    expect(result.success).toBe(false);
  });

  it('rejects missing requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1' });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
      requestedLimit: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
      requestedLimit: '-100',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1',
      requestedLimit: '100',
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  drawSchema                                                         */
/* ------------------------------------------------------------------ */
describe('drawSchema', () => {
  it('accepts a valid amount', () => {
    const result = drawSchema.safeParse({ amount: '500' });
    expect(result.success).toBe(true);
  });

  it('accepts a decimal amount', () => {
    const result = drawSchema.safeParse({ amount: '500.25' });
    expect(result.success).toBe(true);
  });

  it('rejects missing amount', () => {
    const result = drawSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric amount', () => {
    const result = drawSchema.safeParse({ amount: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects numeric (non-string) amount', () => {
    const result = drawSchema.safeParse({ amount: 500 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = drawSchema.safeParse({ amount: '500', extra: true });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  repaySchema                                                        */
/* ------------------------------------------------------------------ */
describe('repaySchema', () => {
  it('accepts a valid amount', () => {
    const result = repaySchema.safeParse({ amount: '200' });
    expect(result.success).toBe(true);
  });

  it('rejects missing amount', () => {
    const result = repaySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric amount', () => {
    const result = repaySchema.safeParse({ amount: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = repaySchema.safeParse({ amount: '200', extra: true });
    expect(result.success).toBe(false);
  });
});

describe('creditLinesQuerySchema', () => {
  it('accepts empty query', () => {
    const result = creditLinesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('coerces numeric query strings', () => {
    const result = creditLinesQuerySchema.safeParse({ offset: '0', limit: '25' });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ offset: 0, limit: 25 });
  });

  it('rejects invalid limit', () => {
    const result = creditLinesQuerySchema.safeParse({ limit: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = creditLinesQuerySchema.safeParse({ offset: '0', foo: 'bar' });
    expect(result.success).toBe(false);
  });
});

describe('transactionHistoryQuerySchema', () => {
  it('accepts valid filters and pagination', () => {
    const result = transactionHistoryQuerySchema.safeParse({
      type: 'borrow',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
      page: '1',
      limit: '20',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid transaction type', () => {
    const result = transactionHistoryQuerySchema.safeParse({ type: 'draw' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date', () => {
    const result = transactionHistoryQuerySchema.safeParse({ from: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid page/limit bounds', () => {
    const result = transactionHistoryQuerySchema.safeParse({ page: '0', limit: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = transactionHistoryQuerySchema.safeParse({ page: '1', unknown: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('riskHistoryQuerySchema', () => {
  it('accepts empty query', () => {
    const result = riskHistoryQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('coerces valid pagination values', () => {
    const result = riskHistoryQuerySchema.safeParse({ offset: '0', limit: '50' });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ offset: 0, limit: 50 });
  });

  it('rejects negative offset', () => {
    const result = riskHistoryQuerySchema.safeParse({ offset: '-1' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = riskHistoryQuerySchema.safeParse({ limit: '10', foo: 'bar' });
    expect(result.success).toBe(false);
  });
});
