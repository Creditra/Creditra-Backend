import { describe, it, expect } from 'vitest';
import {
  createCreditLineSchema,
  creditLinesQuerySchema,
  updateCreditLineSchema,
  drawSchema,
  repaySchema,
  riskEvaluateSchema,
  riskHistoryQuerySchema,
  transactionHistoryQuerySchema,
  idParamSchema,
  walletAddressParamSchema,
  issueApiKeySchema,
  maintenanceToggleSchema,
  bulkCreditLinesSchema,
  envelopedCreditLineSchema,
  envelopedRiskResultSchema,
  errorEnvelopeSchema,
} from '../../src/schemas/index.js';

describe('schemas index exports', () => {
  it('re-exports credit schemas', () => {
    expect(createCreditLineSchema).toBeDefined();
    expect(creditLinesQuerySchema).toBeDefined();
    expect(updateCreditLineSchema).toBeDefined();
    expect(drawSchema).toBeDefined();
    expect(repaySchema).toBeDefined();
    expect(transactionHistoryQuerySchema).toBeDefined();
  });

  it('re-exports risk schemas', () => {
    expect(riskEvaluateSchema).toBeDefined();
    expect(riskHistoryQuerySchema).toBeDefined();
  });

  it('re-exports params, admin, and response schemas', () => {
    expect(idParamSchema).toBeDefined();
    expect(walletAddressParamSchema).toBeDefined();
    expect(issueApiKeySchema).toBeDefined();
    expect(maintenanceToggleSchema).toBeDefined();
    expect(bulkCreditLinesSchema).toBeDefined();
    expect(envelopedCreditLineSchema).toBeDefined();
    expect(envelopedRiskResultSchema).toBeDefined();
    expect(errorEnvelopeSchema).toBeDefined();
  });
});

