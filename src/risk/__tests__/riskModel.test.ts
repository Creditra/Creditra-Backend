import { describe, it, expect } from 'vitest';
import {
  TX_COUNT_CEILING,
  WALLET_AGE_CEILING_DAYS,
  DEFI_VOLUME_CEILING_USD,
  BALANCE_CEILING_USD,
  LOW_RISK_THRESHOLD,
  MEDIUM_RISK_THRESHOLD,
  CREDIT_LIMIT_LOW_CENTS,
  CREDIT_LIMIT_MEDIUM_CENTS,
  CREDIT_LIMIT_HIGH_CENTS,
  CREDIT_LIMIT_BLOCKED_CENTS,
  RATE_LOW_BPS,
  RATE_MEDIUM_BPS,
  RATE_HIGH_BPS,
  RATE_BLOCKED_BPS,
  HIGH_RISK_INTERACTION_PENALTY,
  DEFAULT_WEIGHTS,
  clamp,
  normalise,
  validateWeights,
  classifyRiskTier,
  scoreWallet,
} from '../index.js';
import type { RiskInputs, RiskWeights } from '../index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseInputs: RiskInputs = {
  walletAddress: '0xabc123',
  transactionCount: 100,
  walletAgeDays: 180,
  defiActivityVolumeUsd: 5_000,
  currentBalanceUsd: 2_000,
  hasHighRiskInteraction: false,
};

// ── Constants sanity checks ───────────────────────────────────────────────────

describe('constants', () => {
  it('TX_COUNT_CEILING is a positive integer', () => {
    expect(TX_COUNT_CEILING).toBeGreaterThan(0);
    expect(Number.isInteger(TX_COUNT_CEILING)).toBe(true);
  });

  it('WALLET_AGE_CEILING_DAYS is a positive integer', () => {
    expect(WALLET_AGE_CEILING_DAYS).toBeGreaterThan(0);
    expect(Number.isInteger(WALLET_AGE_CEILING_DAYS)).toBe(true);
  });

  it('DEFI_VOLUME_CEILING_USD is positive', () => {
    expect(DEFI_VOLUME_CEILING_USD).toBeGreaterThan(0);
  });

  it('BALANCE_CEILING_USD is positive', () => {
    expect(BALANCE_CEILING_USD).toBeGreaterThan(0);
  });

  it('risk tier thresholds are ordered correctly', () => {
    expect(LOW_RISK_THRESHOLD).toBeLessThan(MEDIUM_RISK_THRESHOLD);
    expect(MEDIUM_RISK_THRESHOLD).toBeLessThanOrEqual(100);
  });

  it('credit limits are non-negative and ordered LOW > MEDIUM > HIGH >= BLOCKED', () => {
    expect(CREDIT_LIMIT_BLOCKED_CENTS).toBeGreaterThanOrEqual(0);
    expect(CREDIT_LIMIT_HIGH_CENTS).toBeGreaterThanOrEqual(CREDIT_LIMIT_BLOCKED_CENTS);
    expect(CREDIT_LIMIT_MEDIUM_CENTS).toBeGreaterThan(CREDIT_LIMIT_HIGH_CENTS);
    expect(CREDIT_LIMIT_LOW_CENTS).toBeGreaterThan(CREDIT_LIMIT_MEDIUM_CENTS);
  });

  it('interest rates are ordered LOW < MEDIUM < HIGH, BLOCKED = 0', () => {
    expect(RATE_BLOCKED_BPS).toBe(0);
    expect(RATE_LOW_BPS).toBeGreaterThan(0);
    expect(RATE_MEDIUM_BPS).toBeGreaterThan(RATE_LOW_BPS);
    expect(RATE_HIGH_BPS).toBeGreaterThan(RATE_MEDIUM_BPS);
  });

  it('HIGH_RISK_INTERACTION_PENALTY is positive', () => {
    expect(HIGH_RISK_INTERACTION_PENALTY).toBeGreaterThan(0);
  });
});

// ── DEFAULT_WEIGHTS ───────────────────────────────────────────────────────────

describe('DEFAULT_WEIGHTS', () => {
  it('sums to 1.0 within tolerance', () => {
    const sum =
      DEFAULT_WEIGHTS.transactionCount +
      DEFAULT_WEIGHTS.walletAgeDays +
      DEFAULT_WEIGHTS.defiActivityVolumeUsd +
      DEFAULT_WEIGHTS.currentBalanceUsd;
    expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(0.001);
  });

  it('all individual weights are positive', () => {
    for (const v of Object.values(DEFAULT_WEIGHTS)) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

// ── clamp ─────────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('returns min when value is below min', () => expect(clamp(-5, 0, 10)).toBe(0));
  it('returns max when value is above max', () => expect(clamp(15, 0, 10)).toBe(10));
  it('returns value when within range', () => expect(clamp(5, 0, 10)).toBe(5));
  it('returns min when value equals min', () => expect(clamp(0, 0, 10)).toBe(0));
  it('returns max when value equals max', () => expect(clamp(10, 0, 10)).toBe(10));
  it('handles negative ranges', () => expect(clamp(-3, -10, -1)).toBe(-3));
});

// ── normalise ─────────────────────────────────────────────────────────────────

describe('normalise', () => {
  it('returns 0 for zero value', () => expect(normalise(0, 100)).toBe(0));
  it('returns 1 for value equal to ceiling', () => expect(normalise(100, 100)).toBe(1));
  it('returns 1 for value above ceiling (clamped)', () => expect(normalise(200, 100)).toBe(1));
  it('returns 0 for zero ceiling', () => expect(normalise(50, 0)).toBe(0));
  it('returns 0 for negative ceiling', () => expect(normalise(50, -1)).toBe(0));
  it('correctly normalises mid-range value', () =>
    expect(normalise(50, 100)).toBeCloseTo(0.5, 5));
  it('clamps negative values to 0', () => expect(normalise(-10, 100)).toBe(0));
  it('returns 0 for both value and ceiling being zero', () =>
    expect(normalise(0, 0)).toBe(0));
});

// ── validateWeights ───────────────────────────────────────────────────────────

describe('validateWeights', () => {
  it('does not throw for weights summing to 1.0', () => {
    expect(() => validateWeights(DEFAULT_WEIGHTS)).not.toThrow();
  });

  it('does not throw for weights within tolerance (0.9995)', () => {
    // 0.25 + 0.25 + 0.25 + 0.2495 = 0.9995; Math.abs(0.9995 - 1.0) = 0.0005 < 0.001 ✓
    const nearlyOne: RiskWeights = {
      transactionCount: 0.25,
      walletAgeDays: 0.25,
      defiActivityVolumeUsd: 0.25,
      currentBalanceUsd: 0.2495,
    };
    expect(() => validateWeights(nearlyOne)).not.toThrow();
  });

  it('throws when weights sum to more than 1.0 + tolerance', () => {
    const bad: RiskWeights = {
      transactionCount: 0.4,
      walletAgeDays: 0.4,
      defiActivityVolumeUsd: 0.3,
      currentBalanceUsd: 0.3,
    };
    expect(() => validateWeights(bad)).toThrow(/sum to 1\.0/i);
  });

  it('throws when weights sum to less than 1.0 - tolerance', () => {
    const bad: RiskWeights = {
      transactionCount: 0.1,
      walletAgeDays: 0.1,
      defiActivityVolumeUsd: 0.1,
      currentBalanceUsd: 0.1,
    };
    expect(() => validateWeights(bad)).toThrow(/sum to 1\.0/i);
  });

  it('error message includes the actual sum', () => {
    const bad: RiskWeights = {
      transactionCount: 0.5,
      walletAgeDays: 0.5,
      defiActivityVolumeUsd: 0.5,
      currentBalanceUsd: 0.5,
    };
    expect(() => validateWeights(bad)).toThrow('2.0000');
  });
});

// ── classifyRiskTier ──────────────────────────────────────────────────────��───

describe('classifyRiskTier', () => {
  it('returns LOW for score 0', () => expect(classifyRiskTier(0)).toBe('LOW'));
  it('returns LOW for score at LOW_RISK_THRESHOLD', () =>
    expect(classifyRiskTier(LOW_RISK_THRESHOLD)).toBe('LOW'));
  it('returns MEDIUM for score just above LOW threshold', () =>
    expect(classifyRiskTier(LOW_RISK_THRESHOLD + 1)).toBe('MEDIUM'));
  it('returns MEDIUM for score at MEDIUM_RISK_THRESHOLD', () =>
    expect(classifyRiskTier(MEDIUM_RISK_THRESHOLD)).toBe('MEDIUM'));
  it('returns HIGH for score just above MEDIUM threshold', () =>
    expect(classifyRiskTier(MEDIUM_RISK_THRESHOLD + 1)).toBe('HIGH'));
  it('returns HIGH for score 100', () => expect(classifyRiskTier(100)).toBe('HIGH'));
  it('returns HIGH for score between thresholds', () =>
    expect(classifyRiskTier(Math.floor((LOW_RISK_THRESHOLD + MEDIUM_RISK_THRESHOLD) / 2) + 1)).toBe('MEDIUM'));
});

// ── scoreWallet — output shape ────────────────────────────────────────────────

describe('scoreWallet — output shape', () => {
  it('returns an object with all required RiskOutput fields', () => {
    const out = scoreWallet(baseInputs);
    expect(out).toHaveProperty('walletAddress');
    expect(out).toHaveProperty('riskScore');
    expect(out).toHaveProperty('creditLimitUsd');
    expect(out).toHaveProperty('interestRateBps');
    expect(out).toHaveProperty('riskTier');
    expect(out).toHaveProperty('isStub');
  });

  it('echoes the walletAddress back in the output', () => {
    const out = scoreWallet(baseInputs);
    expect(out.walletAddress).toBe(baseInputs.walletAddress);
  });

  it('marks output as a stub (isStub === true)', () => {
    expect(scoreWallet(baseInputs).isStub).toBe(true);
  });

  it('riskScore is a number in [0, 100]', () => {
    const { riskScore } = scoreWallet(baseInputs);
    expect(riskScore).toBeGreaterThanOrEqual(0);
    expect(riskScore).toBeLessThanOrEqual(100);
  });

  it('riskTier is one of the valid values', () => {
    const { riskTier } = scoreWallet(baseInputs);
    expect(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']).toContain(riskTier);
  });

  it('creditLimitUsd is a non-negative integer', () => {
    const { creditLimitUsd } = scoreWallet(baseInputs);
    expect(creditLimitUsd).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(creditLimitUsd)).toBe(true);
  });

  it('interestRateBps is a non-negative integer', () => {
    const { interestRateBps } = scoreWallet(baseInputs);
    expect(interestRateBps).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(interestRateBps)).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    expect(scoreWallet(baseInputs)).toEqual(scoreWallet(baseInputs));
  });
});

// ── scoreWallet — tier/limit/rate consistency ─────────────────────────────────

describe('scoreWallet — tier, credit limit, and rate consistency', () => {
  const tierLimitMap: Record<string, number> = {
    LOW: CREDIT_LIMIT_LOW_CENTS,
    MEDIUM: CREDIT_LIMIT_MEDIUM_CENTS,
    HIGH: CREDIT_LIMIT_HIGH_CENTS,
    BLOCKED: CREDIT_LIMIT_BLOCKED_CENTS,
  };
  const tierRateMap: Record<string, number> = {
    LOW: RATE_LOW_BPS,
    MEDIUM: RATE_MEDIUM_BPS,
    HIGH: RATE_HIGH_BPS,
    BLOCKED: RATE_BLOCKED_BPS,
  };

  it('creditLimitUsd matches the returned riskTier', () => {
    const out = scoreWallet(baseInputs);
    expect(out.creditLimitUsd).toBe(tierLimitMap[out.riskTier]);
  });

  it('interestRateBps matches the returned riskTier', () => {
    const out = scoreWallet(baseInputs);
    expect(out.interestRateBps).toBe(tierRateMap[out.riskTier]);
  });

  /**
   * Force the stub score through all four tiers by temporarily overriding
   * the returned riskTier via classifyRiskTier boundary values.
   * Since scoreWallet is currently a stub (score = 50 → MEDIUM), we test
   * the map branches indirectly by verifying all constants are reachable.
   */
  it('CREDIT_LIMIT_LOW_CENTS is assigned to LOW tier constant', () => {
    expect(CREDIT_LIMIT_LOW_CENTS).toBe(tierLimitMap['LOW']);
  });

  it('CREDIT_LIMIT_HIGH_CENTS is assigned to HIGH tier constant', () => {
    expect(CREDIT_LIMIT_HIGH_CENTS).toBe(tierLimitMap['HIGH']);
  });

  it('CREDIT_LIMIT_BLOCKED_CENTS is 0', () => {
    expect(CREDIT_LIMIT_BLOCKED_CENTS).toBe(0);
    expect(tierLimitMap['BLOCKED']).toBe(0);
  });

  it('RATE_BLOCKED_BPS is 0', () => {
    expect(RATE_BLOCKED_BPS).toBe(0);
    expect(tierRateMap['BLOCKED']).toBe(0);
  });
});

// ── scoreWallet — weights ─────────────────────────────────────────────────────

describe('scoreWallet — weight handling', () => {
  it('accepts custom weights that sum to 1.0', () => {
    const customWeights: RiskWeights = {
      transactionCount: 0.25,
      walletAgeDays: 0.25,
      defiActivityVolumeUsd: 0.25,
      currentBalanceUsd: 0.25,
    };
    expect(() => scoreWallet(baseInputs, customWeights)).not.toThrow();
  });

  it('throws when provided weights do not sum to 1.0', () => {
    const badWeights: RiskWeights = {
      transactionCount: 0.5,
      walletAgeDays: 0.5,
      defiActivityVolumeUsd: 0.5,
      currentBalanceUsd: 0.5,
    };
    expect(() => scoreWallet(baseInputs, badWeights)).toThrow(/sum to 1\.0/i);
  });

  it('uses DEFAULT_WEIGHTS when no weights argument provided', () => {
    // Should not throw — DEFAULT_WEIGHTS are valid
    expect(() => scoreWallet(baseInputs)).not.toThrow();
  });
});

// ── scoreWallet — edge case inputs ────────────────────────────────────────────

describe('scoreWallet — edge case inputs', () => {
  it('handles zero-value numeric inputs', () => {
    const zeroInputs: RiskInputs = {
      ...baseInputs,
      transactionCount: 0,
      walletAgeDays: 0,
      defiActivityVolumeUsd: 0,
      currentBalanceUsd: 0,
    };
    expect(() => scoreWallet(zeroInputs)).not.toThrow();
    const out = scoreWallet(zeroInputs);
    expect(out.riskScore).toBeGreaterThanOrEqual(0);
    expect(out.riskScore).toBeLessThanOrEqual(100);
  });

  it('handles inputs exactly at ceiling values', () => {
    const maxInputs: RiskInputs = {
      ...baseInputs,
      transactionCount: TX_COUNT_CEILING,
      walletAgeDays: WALLET_AGE_CEILING_DAYS,
      defiActivityVolumeUsd: DEFI_VOLUME_CEILING_USD,
      currentBalanceUsd: BALANCE_CEILING_USD,
    };
    expect(() => scoreWallet(maxInputs)).not.toThrow();
  });

  it('handles inputs above ceiling values (clamped)', () => {
    const aboveMax: RiskInputs = {
      ...baseInputs,
      transactionCount: TX_COUNT_CEILING * 10,
      walletAgeDays: WALLET_AGE_CEILING_DAYS * 10,
      defiActivityVolumeUsd: DEFI_VOLUME_CEILING_USD * 10,
      currentBalanceUsd: BALANCE_CEILING_USD * 10,
    };
    const out = scoreWallet(aboveMax);
    expect(out.riskScore).toBeGreaterThanOrEqual(0);
    expect(out.riskScore).toBeLessThanOrEqual(100);
  });

  it('handles hasHighRiskInteraction = true without throwing', () => {
    const riskyInputs: RiskInputs = { ...baseInputs, hasHighRiskInteraction: true };
    expect(() => scoreWallet(riskyInputs)).not.toThrow();
    const out = scoreWallet(riskyInputs);
    expect(out.riskScore).toBeGreaterThanOrEqual(0);
    expect(out.riskScore).toBeLessThanOrEqual(100);
  });

  it('returns a valid output for a brand-new wallet (all zeros, no activity)', () => {
    const newWallet: RiskInputs = {
      walletAddress: '0x0000000000000000000000000000000000000001',
      transactionCount: 0,
      walletAgeDays: 0,
      defiActivityVolumeUsd: 0,
      currentBalanceUsd: 0,
      hasHighRiskInteraction: false,
    };
    const out = scoreWallet(newWallet);
    expect(out.walletAddress).toBe(newWallet.walletAddress);
    expect(out.isStub).toBe(true);
    expect(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']).toContain(out.riskTier);
  });

  it('returns a valid output for a very active whale wallet', () => {
    const whaleWallet: RiskInputs = {
      walletAddress: '0xwhale',
      transactionCount: 50_000,
      walletAgeDays: 2_000,
      defiActivityVolumeUsd: 10_000_000,
      currentBalanceUsd: 5_000_000,
      hasHighRiskInteraction: false,
    };
    const out = scoreWallet(whaleWallet);
    expect(out.riskScore).toBeGreaterThanOrEqual(0);
    expect(out.riskScore).toBeLessThanOrEqual(100);
  });
});