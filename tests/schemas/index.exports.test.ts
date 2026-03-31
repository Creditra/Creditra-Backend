import { describe, it, expect } from 'vitest';
import {
  createCreditLineSchema,
  creditLinesQuerySchema,
  drawSchema,
  repaySchema,
  riskEvaluateSchema,
  riskHistoryQuerySchema,
  transactionHistoryQuerySchema,
} from '../../src/schemas/index.js';

describe('schemas index exports', () => {
  it('re-exports credit schemas', () => {
    expect(createCreditLineSchema).toBeDefined();
    expect(creditLinesQuerySchema).toBeDefined();
    expect(drawSchema).toBeDefined();
    expect(repaySchema).toBeDefined();
    expect(transactionHistoryQuerySchema).toBeDefined();
  });

  it('re-exports risk schemas', () => {
    expect(riskEvaluateSchema).toBeDefined();
    expect(riskHistoryQuerySchema).toBeDefined();
  });
});
