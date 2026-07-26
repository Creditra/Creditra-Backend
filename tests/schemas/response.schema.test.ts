import { describe, it, expect } from 'vitest';
import {
  updateCreditLineSchema,
  creditLinesQuerySchema,
  idParamSchema,
  walletAddressParamSchema,
  issueApiKeySchema,
  maintenanceToggleSchema,
  bulkCreditLinesSchema,
  envelopedCreditLineSchema,
  envelopedCreditLinesListSchema,
  creditLinesCursorDataSchema,
  envelopedRiskResultSchema,
  drawRepayResultSchema,
  errorEnvelopeSchema,
} from '../../src/schemas/index.js';

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

describe('updateCreditLineSchema', () => {
  it('accepts partial updates', () => {
    expect(updateCreditLineSchema.safeParse({ creditLimit: '1500.00' }).success).toBe(true);
    expect(updateCreditLineSchema.safeParse({ interestRateBps: 500 }).success).toBe(true);
    expect(updateCreditLineSchema.safeParse({ status: 'suspended' }).success).toBe(true);
    expect(updateCreditLineSchema.safeParse({ expectedVersion: 2 }).success).toBe(true);
  });

  it('rejects empty body', () => {
    expect(updateCreditLineSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown keys and invalid status', () => {
    expect(updateCreditLineSchema.safeParse({ creditLimit: '1', extra: true }).success).toBe(false);
    expect(updateCreditLineSchema.safeParse({ status: 'pending' }).success).toBe(false);
  });
});

describe('creditLinesQuerySchema cursor mode', () => {
  it('accepts empty cursor string (first page)', () => {
    const result = creditLinesQuerySchema.safeParse({ cursor: '', limit: '3' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBe('');
      expect(result.data.limit).toBe(3);
    }
  });
});

describe('params schemas', () => {
  it('idParamSchema rejects empty id', () => {
    expect(idParamSchema.safeParse({ id: '' }).success).toBe(false);
    expect(idParamSchema.safeParse({ id: 'cl_abc' }).success).toBe(true);
  });

  it('walletAddressParamSchema requires valid Stellar address', () => {
    expect(walletAddressParamSchema.safeParse({ walletAddress: VALID_ADDRESS }).success).toBe(
      true,
    );
    expect(walletAddressParamSchema.safeParse({ walletAddress: 'wallet0' }).success).toBe(false);
  });
});

describe('admin schemas', () => {
  it('issueApiKeySchema accepts empty or labelled body', () => {
    expect(issueApiKeySchema.safeParse({}).success).toBe(true);
    expect(issueApiKeySchema.safeParse({ label: 'partner-a' }).success).toBe(true);
    expect(issueApiKeySchema.safeParse({ label: 'x', extra: 1 }).success).toBe(false);
  });

  it('maintenanceToggleSchema requires boolean enabled', () => {
    expect(maintenanceToggleSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(maintenanceToggleSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });

  it('bulkCreditLinesSchema enforces row bounds', () => {
    expect(bulkCreditLinesSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(bulkCreditLinesSchema.safeParse({ rows: [{}] }).success).toBe(true);
    expect(bulkCreditLinesSchema.safeParse({ rows: new Array(201).fill({}) }).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('validates credit line envelope', () => {
    const result = envelopedCreditLineSchema.safeParse({
      data: {
        id: 'uuid',
        walletAddress: VALID_ADDRESS,
        creditLimit: '1000.00',
        availableCredit: '1000.00',
        utilized: '0',
        interestRateBps: 500,
        status: 'active',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date().toISOString(),
      },
      error: null,
    });
    expect(result.success).toBe(true);
  });

  it('validates list + cursor response shapes', () => {
    expect(
      envelopedCreditLinesListSchema.safeParse({
        data: {
          creditLines: [],
          pagination: { total: 0, offset: 0, limit: 100 },
        },
        error: null,
      }).success,
    ).toBe(true);

    expect(
      creditLinesCursorDataSchema.safeParse({
        creditLines: [],
        pagination: { limit: 10, nextCursor: null, hasMore: false },
      }).success,
    ).toBe(true);
  });

  it('validates risk result and draw/repay contracts', () => {
    expect(
      envelopedRiskResultSchema.safeParse({
        data: {
          walletAddress: VALID_ADDRESS,
          riskScore: 80,
          creditLimit: '800',
          interestRateBps: 600,
          message: 'New risk evaluation completed',
        },
        error: null,
      }).success,
    ).toBe(true);

    expect(
      drawRepayResultSchema.safeParse({
        id: 'line-1',
        walletAddress: VALID_ADDRESS,
        amount: '50',
        txHash: null,
        status: 'pending',
      }).success,
    ).toBe(true);
  });

  it('validates error envelope with optional details', () => {
    expect(
      errorEnvelopeSchema.safeParse({
        data: null,
        error: 'Validation failed',
        details: [{ field: 'amount', message: 'Required' }],
      }).success,
    ).toBe(true);
  });
});
