import { describe, it, expect } from 'vitest';
import {
  riskEvaluateSchema,
} from '../../src/schemas/risk.schema.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
} from '../../src/schemas/credit.schema.js';

/* ------------------------------------------------------------------ */
/*  riskEvaluateSchema                                                 */
/* ------------------------------------------------------------------ */
describe('riskEvaluateSchema', () => {
  it('accepts a valid walletAddress', () => {
    const result = riskEvaluateSchema.safeParse({ walletAddress: 'GABCDEF' });
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
});

/* ------------------------------------------------------------------ */
/*  createCreditLineSchema                                             */
/* ------------------------------------------------------------------ */
describe('createCreditLineSchema', () => {
  it('accepts valid body', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GABCDEF',
      requestedLimit: '1000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts decimal requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GABCDEF',
      requestedLimit: '1000.50',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing walletAddress', () => {
    const result = createCreditLineSchema.safeParse({ requestedLimit: '100' });
    expect(result.success).toBe(false);
  });

  it('rejects missing requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({ walletAddress: 'GABCDEF' });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GABCDEF',
      requestedLimit: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative requestedLimit', () => {
    const result = createCreditLineSchema.safeParse({
      walletAddress: 'GABCDEF',
      requestedLimit: '-100',
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
});
