import { describe, it, expect } from 'vitest';
import { evaluateRisk, DEFAULT_WEIGHTS } from '../index.js';
import type { RiskInputs, RiskWeights } from '../types.js';

const baseInputs: RiskInputs = {
  walletAddress: '0xdeadbeef',
  transactionCount: 200,
  walletAgeDays: 400,
  defiActivityVolumeUsd: 10_000,
  currentBalanceUsd: 5_000,
  hasHighRiskInteraction: false,
};

describe('evaluateRisk', () => {
  it('returns a Promise', () => {
    const result = evaluateRisk(baseInputs);
    expect(result).toBeInstanceOf(Promise);
  });

  it('resolves to an object with all RiskOutput fields', async () => {
    const out = await evaluateRisk(baseInputs);
    expect(out).toHaveProperty('walletAddress');
    expect(out).toHaveProperty('riskScore');
    expect(out).toHaveProperty('creditLimitUsd');
    expect(out).toHaveProperty('interestRateBps');
    expect(out).toHaveProperty('riskTier');
    expect(out).toHaveProperty('isStub');
  });

  it('echoes back the correct walletAddress', async () => {
    const out = await evaluateRisk(baseInputs);
    expect(out.walletAddress).toBe(baseInputs.walletAddress);
  });

  it('marks output as stub', async () => {
    const out = await evaluateRisk(baseInputs);
    expect(out.isStub).toBe(true);
  });

  it('riskScore is a number in [0, 100]', async () => {
    const { riskScore } = await evaluateRisk(baseInputs);
    expect(typeof riskScore).toBe('number');
    expect(riskScore).toBeGreaterThanOrEqual(0);
    expect(riskScore).toBeLessThanOrEqual(100);
  });

  it('riskTier is one of the valid enum values', async () => {
    const { riskTier } = await evaluateRisk(baseInputs);
    expect(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']).toContain(riskTier);
  });

  it('creditLimitUsd is a non-negative integer', async () => {
    const { creditLimitUsd } = await evaluateRisk(baseInputs);
    expect(creditLimitUsd).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(creditLimitUsd)).toBe(true);
  });

  it('interestRateBps is a non-negative integer', async () => {
    const { interestRateBps } = await evaluateRisk(baseInputs);
    expect(interestRateBps).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(interestRateBps)).toBe(true);
  });

  it('is deterministic for identical inputs', async () => {
    const [out1, out2] = await Promise.all([
      evaluateRisk(baseInputs),
      evaluateRisk(baseInputs),
    ]);
    expect(out1).toEqual(out2);
  });

  it('rejects when invalid weights are supplied', async () => {
    const badWeights: RiskWeights = {
      transactionCount: 1,
      walletAgeDays: 1,
      defiActivityVolumeUsd: 1,
      currentBalanceUsd: 1,
    };
    await expect(evaluateRisk(baseInputs, badWeights)).rejects.toThrow(/sum to 1\.0/i);
  });

  it('uses DEFAULT_WEIGHTS when no weights argument is provided', async () => {
    // Explicitly passing DEFAULT_WEIGHTS must produce the same result as omitting them
    const withDefault = await evaluateRisk(baseInputs, DEFAULT_WEIGHTS);
    const withOmitted = await evaluateRisk(baseInputs);
    expect(withDefault).toEqual(withOmitted);
  });

  it('accepts explicit DEFAULT_WEIGHTS without throwing', async () => {
    await expect(evaluateRisk(baseInputs, DEFAULT_WEIGHTS)).resolves.toBeDefined();
  });

  it('handles hasHighRiskInteraction = true', async () => {
    const riskyInputs: RiskInputs = { ...baseInputs, hasHighRiskInteraction: true };
    const out = await evaluateRisk(riskyInputs);
    expect(out.riskScore).toBeGreaterThanOrEqual(0);
    expect(out.riskScore).toBeLessThanOrEqual(100);
    expect(out.isStub).toBe(true);
  });

  it('handles a brand-new zero-activity wallet', async () => {
    const newWallet: RiskInputs = {
      walletAddress: '0x0000000000000000000000000000000000000001',
      transactionCount: 0,
      walletAgeDays: 0,
      defiActivityVolumeUsd: 0,
      currentBalanceUsd: 0,
      hasHighRiskInteraction: false,
    };
    const out = await evaluateRisk(newWallet);
    expect(out.walletAddress).toBe(newWallet.walletAddress);
    expect(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']).toContain(out.riskTier);
  });

  it('handles a high-volume whale wallet', async () => {
    const whale: RiskInputs = {
      walletAddress: '0xwhale',
      transactionCount: 99_999,
      walletAgeDays: 3_000,
      defiActivityVolumeUsd: 99_999_999,
      currentBalanceUsd: 9_999_999,
      hasHighRiskInteraction: false,
    };
    const out = await evaluateRisk(whale);
    expect(out.riskScore).toBeGreaterThanOrEqual(0);
    expect(out.riskScore).toBeLessThanOrEqual(100);
  });

  it('resolves multiple concurrent evaluations independently', async () => {
    const inputs2: RiskInputs = { ...baseInputs, walletAddress: '0xother' };
    const [out1, out2] = await Promise.all([
      evaluateRisk(baseInputs),
      evaluateRisk(inputs2),
    ]);
    expect(out1.walletAddress).toBe(baseInputs.walletAddress);
    expect(out2.walletAddress).toBe('0xother');
  });
});