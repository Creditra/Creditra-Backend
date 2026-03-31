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

const VALID_ADDRESS = 'G' + 'A'.repeat(55);
const INVALID_ADDRESS = 'GABCDEF';

describe('riskEvaluateSchema', () => {
  it('accepts a valid Stellar walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: VALID_ADDRESS });
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

  it('rejects walletAddress that is not a valid Stellar address', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: INVALID_ADDRESS });
    expect(result.success).toBe(false);
  });

  it('rejects non-string walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 123 });
    expect(result.success).toBe(false);
  });

  it('accepts optional forceRefresh', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: VALID_ADDRESS, forceRefresh: true });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: VALID_ADDRESS, extra: 'nope' });
    expect(result.success).toBe(false);
  });
});

describe('createCreditLineSchema', () => {
  it('accepts valid body', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: VALID_ADDRESS,
      requestedLimit: '1000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts decimal requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: VALID_ADDRESS,
      requestedLimit: '1000.50',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const result = createCreditLineSchema.safeParse({ requestedLimit: '100' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid Stellar walletAddress', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: INVALID_ADDRESS,
      requestedLimit: '100',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({ walletAddress: VALID_ADDRESS });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: VALID_ADDRESS,
      requestedLimit: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: VALID_ADDRESS,
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

describe('drawSchema', () => {
  it('accepts a valid walletAddress and amount', () => {
    const result = drawSchema.safeParse({ walletAddress: VALID_ADDRESS, amount: '500' });
    expect(result.success).toBe(true);
  });

  it('accepts a decimal amount', () => {
    const result = drawSchema.safeParse({ walletAddress: VALID_ADDRESS, amount: '500.25' });
    expect(result.success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const result = drawSchema.safeParse({ amount: '500' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid Stellar walletAddress', () => {
    const result = drawSchema.safeParse({ walletAddress: INVALID_ADDRESS, amount: '500' });
    expect(result.success).toBe(false);
  });

  it('rejects missing amount', () => {
    const result = drawSchema.safeParse({ walletAddress: VALID_ADDRESS });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric amount', () => {
    const result = drawSchema.safeParse({ walletAddress: VALID_ADDRESS, amount: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects numeric (non-string) amount', () => {
    const result = drawSchema.safeParse({ walletAddress: VALID_ADDRESS, amount: 500 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = drawSchema.safeParse({ amount: '500', extra: true });
    expect(result.success).toBe(false);
  });
});

describe('repaySchema', () => {
  it('accepts a valid walletAddress and amount', () => {
    const result = repaySchema.safeParse({ walletAddress: VALID_ADDRESS, amount: '200' });
    expect(result.success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const result = repaySchema.safeParse({ amount: '200' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid Stellar walletAddress', () => {
    const result = repaySchema.safeParse({ walletAddress: INVALID_ADDRESS, amount: '200' });
    expect(result.success).toBe(false);
  });

  it('rejects missing amount', () => {
    const result = repaySchema.safeParse({ walletAddress: VALID_ADDRESS });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric amount', () => {
    const result = repaySchema.safeParse({ walletAddress: VALID_ADDRESS, amount: 'nope' });
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
