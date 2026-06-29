/**
 * Credit Policy Engine
 *
 * Centralises credit eligibility and risk rules (limits, cooldowns, KYC gates)
 * with an explicit rule registry and machine-readable rejection reasons.
 *
 * Usage:
 *   const result = evaluatePolicy(registry, context);
 *   if (!result.approved) console.log(result.rejections);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input context passed to every rule during evaluation. */
export interface PolicyContext {
  walletAddress: string;
  /** Credit score 0–100 (higher = better). */
  creditScore: number;
  /** Requested credit amount in USD cents. */
  requestedAmount: number;
  /** KYC verification level: 0 = none, 1 = basic, 2 = full. */
  kycLevel: number;
  /** ISO-8601 timestamp of the last credit draw, or null if never. */
  lastDrawAt: string | null;
  /** Total outstanding balance in USD cents. */
  outstandingBalance: number;
}

/** Stable machine-readable rejection code. */
export type RejectionCode =
  | 'CREDIT_SCORE_TOO_LOW'
  | 'AMOUNT_EXCEEDS_LIMIT'
  | 'KYC_NOT_VERIFIED'
  | 'COOLDOWN_ACTIVE'
  | 'OUTSTANDING_BALANCE_TOO_HIGH';

/** Outcome of a single rule. */
export interface RuleOutcome {
  passed: boolean;
  code?: RejectionCode;
  reason?: string;
}

/** A credit policy rule. */
export interface PolicyRule {
  /** Unique, stable identifier for this rule. */
  id: string;
  /** Human-readable description. */
  description: string;
  evaluate(ctx: PolicyContext): RuleOutcome;
}

/** Explainable evaluation result. */
export interface PolicyEvaluationResult {
  approved: boolean;
  /** All rejection details when not approved. Empty array when approved. */
  rejections: Array<{ code: RejectionCode; reason: string }>;
  /** IDs of every rule that was evaluated. */
  evaluatedRules: string[];
}

// ---------------------------------------------------------------------------
// Rule Registry
// ---------------------------------------------------------------------------

export class PolicyRuleRegistry {
  private rules: Map<string, PolicyRule> = new Map();

  /** Register a rule. Throws if a rule with the same id already exists. */
  register(rule: PolicyRule): this {
    if (this.rules.has(rule.id)) {
      throw new Error(`Policy rule "${rule.id}" is already registered.`);
    }
    this.rules.set(rule.id, rule);
    return this;
  }

  /** Remove a rule by id. Returns true if it existed. */
  unregister(id: string): boolean {
    return this.rules.delete(id);
  }

  /** Return all registered rules in insertion order. */
  list(): PolicyRule[] {
    return Array.from(this.rules.values());
  }

  /** Look up a rule by id. */
  get(id: string): PolicyRule | undefined {
    return this.rules.get(id);
  }
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

const MINIMUM_CREDIT_SCORE = 40;
const MAXIMUM_AMOUNT_USD_CENTS = 500_000_00; // $500,000
const REQUIRED_KYC_LEVEL = 1;
const COOLDOWN_HOURS = 24;
const MAX_OUTSTANDING_RATIO = 0.8; // 80 % of max limit

export const builtinRules: PolicyRule[] = [
  {
    id: 'credit-score-minimum',
    description: `Credit score must be at least ${MINIMUM_CREDIT_SCORE}.`,
    evaluate(ctx) {
      if (ctx.creditScore >= MINIMUM_CREDIT_SCORE) return { passed: true };
      return {
        passed: false,
        code: 'CREDIT_SCORE_TOO_LOW',
        reason: `Credit score ${ctx.creditScore} is below the minimum of ${MINIMUM_CREDIT_SCORE}.`,
      };
    },
  },
  {
    id: 'amount-within-limit',
    description: `Requested amount must not exceed $${MAXIMUM_AMOUNT_USD_CENTS / 100}.`,
    evaluate(ctx) {
      if (ctx.requestedAmount <= MAXIMUM_AMOUNT_USD_CENTS) return { passed: true };
      return {
        passed: false,
        code: 'AMOUNT_EXCEEDS_LIMIT',
        reason: `Requested amount ${ctx.requestedAmount} cents exceeds the limit of ${MAXIMUM_AMOUNT_USD_CENTS} cents.`,
      };
    },
  },
  {
    id: 'kyc-verified',
    description: `Borrower must have KYC level >= ${REQUIRED_KYC_LEVEL}.`,
    evaluate(ctx) {
      if (ctx.kycLevel >= REQUIRED_KYC_LEVEL) return { passed: true };
      return {
        passed: false,
        code: 'KYC_NOT_VERIFIED',
        reason: `KYC level ${ctx.kycLevel} does not meet the requirement of ${REQUIRED_KYC_LEVEL}.`,
      };
    },
  },
  {
    id: 'draw-cooldown',
    description: `At least ${COOLDOWN_HOURS} hours must have passed since the last draw.`,
    evaluate(ctx) {
      if (!ctx.lastDrawAt) return { passed: true };
      const elapsed = (Date.now() - new Date(ctx.lastDrawAt).getTime()) / 3_600_000;
      if (elapsed >= COOLDOWN_HOURS) return { passed: true };
      return {
        passed: false,
        code: 'COOLDOWN_ACTIVE',
        reason: `Only ${elapsed.toFixed(1)} hours have passed since the last draw; ${COOLDOWN_HOURS} hours required.`,
      };
    },
  },
  {
    id: 'outstanding-balance-limit',
    description: `Outstanding balance must be below ${MAX_OUTSTANDING_RATIO * 100}% of the maximum credit limit.`,
    evaluate(ctx) {
      const threshold = MAXIMUM_AMOUNT_USD_CENTS * MAX_OUTSTANDING_RATIO;
      if (ctx.outstandingBalance <= threshold) return { passed: true };
      return {
        passed: false,
        code: 'OUTSTANDING_BALANCE_TOO_HIGH',
        reason: `Outstanding balance ${ctx.outstandingBalance} cents exceeds the allowed threshold of ${threshold} cents.`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate all rules in the registry against `ctx`.
 * Returns an explainable result with stable rejection codes.
 */
export function evaluatePolicy(
  registry: PolicyRuleRegistry,
  ctx: PolicyContext,
): PolicyEvaluationResult {
  const rejections: PolicyEvaluationResult['rejections'] = [];
  const evaluatedRules: string[] = [];

  for (const rule of registry.list()) {
    evaluatedRules.push(rule.id);
    const outcome = rule.evaluate(ctx);
    if (!outcome.passed && outcome.code && outcome.reason) {
      rejections.push({ code: outcome.code, reason: outcome.reason });
    }
  }

  return { approved: rejections.length === 0, rejections, evaluatedRules };
}

// ---------------------------------------------------------------------------
// Default registry (pre-loaded with all built-in rules)
// ---------------------------------------------------------------------------

export function createDefaultRegistry(): PolicyRuleRegistry {
  const registry = new PolicyRuleRegistry();
  for (const rule of builtinRules) {
    registry.register(rule);
  }
  return registry;
}
