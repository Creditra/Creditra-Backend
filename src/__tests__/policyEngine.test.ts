import { describe, it, expect } from 'vitest';
import {
  PolicyRuleRegistry,
  evaluatePolicy,
  createDefaultRegistry,
  builtinRules,
  type PolicyContext,
} from '../services/policyEngine.js';

const validContext: PolicyContext = {
  walletAddress: 'GTEST123',
  creditScore: 75,
  requestedAmount: 10_000_00, // $10,000
  kycLevel: 1,
  lastDrawAt: null,
  outstandingBalance: 0,
};

describe('PolicyRuleRegistry', () => {
  it('registers rules and prevents duplicate ids', () => {
    const registry = new PolicyRuleRegistry();
    registry.register(builtinRules[0]);
    expect(registry.list()).toHaveLength(1);
    expect(() => registry.register(builtinRules[0])).toThrow(/already registered/);
  });

  it('unregisters a rule by id', () => {
    const registry = createDefaultRegistry();
    const before = registry.list().length;
    const removed = registry.unregister('kyc-verified');
    expect(removed).toBe(true);
    expect(registry.list()).toHaveLength(before - 1);
  });
});

describe('evaluatePolicy — happy path', () => {
  it('approves a valid context against all built-in rules', () => {
    const registry = createDefaultRegistry();
    const result = evaluatePolicy(registry, validContext);
    expect(result.approved).toBe(true);
    expect(result.rejections).toHaveLength(0);
    expect(result.evaluatedRules).toEqual(builtinRules.map((r) => r.id));
  });
});

describe('evaluatePolicy — rejection codes', () => {
  it('rejects with CREDIT_SCORE_TOO_LOW when score is below minimum', () => {
    const registry = createDefaultRegistry();
    const result = evaluatePolicy(registry, { ...validContext, creditScore: 20 });
    expect(result.approved).toBe(false);
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain('CREDIT_SCORE_TOO_LOW');
  });

  it('rejects with AMOUNT_EXCEEDS_LIMIT for an oversized request', () => {
    const registry = createDefaultRegistry();
    const result = evaluatePolicy(registry, {
      ...validContext,
      requestedAmount: 600_000_00, // $600,000 — over limit
    });
    expect(result.approved).toBe(false);
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain('AMOUNT_EXCEEDS_LIMIT');
  });

  it('rejects with KYC_NOT_VERIFIED when kycLevel is 0', () => {
    const registry = createDefaultRegistry();
    const result = evaluatePolicy(registry, { ...validContext, kycLevel: 0 });
    expect(result.approved).toBe(false);
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain('KYC_NOT_VERIFIED');
  });

  it('rejects with COOLDOWN_ACTIVE when last draw was recent', () => {
    const registry = createDefaultRegistry();
    const recentDraw = new Date(Date.now() - 2 * 3_600_000).toISOString(); // 2 hours ago
    const result = evaluatePolicy(registry, { ...validContext, lastDrawAt: recentDraw });
    expect(result.approved).toBe(false);
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain('COOLDOWN_ACTIVE');
  });

  it('rejects with OUTSTANDING_BALANCE_TOO_HIGH for excessive balance', () => {
    const registry = createDefaultRegistry();
    const result = evaluatePolicy(registry, {
      ...validContext,
      outstandingBalance: 450_000_00, // $450,000 — above 80% threshold
    });
    expect(result.approved).toBe(false);
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain('OUTSTANDING_BALANCE_TOO_HIGH');
  });

  it('accumulates multiple rejection codes in a single evaluation', () => {
    const registry = createDefaultRegistry();
    const result = evaluatePolicy(registry, {
      ...validContext,
      creditScore: 10,
      kycLevel: 0,
    });
    expect(result.approved).toBe(false);
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain('CREDIT_SCORE_TOO_LOW');
    expect(codes).toContain('KYC_NOT_VERIFIED');
  });
});

describe('custom rule composition', () => {
  it('allows registering and evaluating a custom rule', () => {
    const registry = new PolicyRuleRegistry();
    registry.register({
      id: 'custom-wallet-blocklist',
      description: 'Blocks a specific wallet address.',
      evaluate(ctx) {
        if (ctx.walletAddress === 'GBLOCKED') {
          return { passed: false, code: 'KYC_NOT_VERIFIED', reason: 'Wallet is blocklisted.' };
        }
        return { passed: true };
      },
    });

    const blocked = evaluatePolicy(registry, { ...validContext, walletAddress: 'GBLOCKED' });
    expect(blocked.approved).toBe(false);

    const allowed = evaluatePolicy(registry, validContext);
    expect(allowed.approved).toBe(true);
  });
});
