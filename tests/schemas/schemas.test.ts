import { describe, it, expect } from 'vitest';
import {
  riskEvaluateSchema,
} from '../../src/schemas/risk.schema.js';
import {
  createCreditLineSchema,
  drawSchema,
  repaySchema,
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
});
