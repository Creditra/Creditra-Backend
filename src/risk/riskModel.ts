import type { RiskInputs, RiskOutput, RiskTier, RiskWeights } from './types.js';

// ---------------------------------------------------------------------------
// Normalisation ceilings
// Each raw input is divided by its ceiling to produce a [0, 1] signal.
// Values above the ceiling are clamped to 1.0 — they add no further benefit.
// ---------------------------------------------------------------------------

/**
 * Transaction count above which the wallet is considered maximally active.
 * Based on empirical P95 of observed DeFi power-users (internal analysis v0).
 */
export const TX_COUNT_CEILING = 1_000;

/**
 * Wallet age (days) above which age contributes its maximum positive signal.
 * Approximately 3 years of on-chain history.
 */
export const WALLET_AGE_CEILING_DAYS = 1_095;

/**
 * DeFi volume (USD) above which volume contributes its maximum positive signal.
 * Represents a high-engagement user threshold (internal analysis v0).
 */
export const DEFI_VOLUME_CEILING_USD = 500_000;

/**
 * Wallet balance (USD) above which balance contributes its maximum positive signal.
 * Represents sufficient on-chain collateral for the current product tier.
 */
export const BALANCE_CEILING_USD = 100_000;

// ---------------------------------------------------------------------------
// Risk tier thresholds
// riskScore is in [0, 100]; lower = better credit profile.
// ---------------------------------------------------------------------------

/**
 * Scores at or below this value classify as LOW risk.
 * Eligible for the highest credit limits and lowest rates.
 */
export const LOW_RISK_THRESHOLD = 30;

/**
 * Scores above LOW_RISK_THRESHOLD and at or below this value are MEDIUM risk.
 */
export const MEDIUM_RISK_THRESHOLD = 60;

/**
 * Scores above MEDIUM_RISK_THRESHOLD are HIGH risk.
 * BLOCKED is determined separately via `hasHighRiskInteraction`.
 */
export const HIGH_RISK_THRESHOLD = 100;

// ---------------------------------------------------------------------------
// Credit limit and rate bands (in USD cents and basis points respectively)
// ---------------------------------------------------------------------------

/** Maximum credit limit (USD cents) for LOW risk tier: $10,000.00 */
export const CREDIT_LIMIT_LOW_CENTS = 1_000_000;

/** Maximum credit limit (USD cents) for MEDIUM risk tier: $3,000.00 */
export const CREDIT_LIMIT_MEDIUM_CENTS = 300_000;

/** Maximum credit limit (USD cents) for HIGH risk tier: $500.00 */
export const CREDIT_LIMIT_HIGH_CENTS = 50_000;

/** Credit limit (USD cents) for BLOCKED wallets: $0.00 */
export const CREDIT_LIMIT_BLOCKED_CENTS = 0;

/** Annual interest rate in bps for LOW risk tier: 8.00 % APR */
export const RATE_LOW_BPS = 800;

/** Annual interest rate in bps for MEDIUM risk tier: 15.00 % APR */
export const RATE_MEDIUM_BPS = 1_500;

/** Annual interest rate in bps for HIGH risk tier: 25.00 % APR */
export const RATE_HIGH_BPS = 2_500;

/** Annual interest rate in bps for BLOCKED wallets: 0 (no credit extended) */
export const RATE_BLOCKED_BPS = 0;

// ---------------------------------------------------------------------------
// Penalty
// ---------------------------------------------------------------------------

/**
 * Flat score penalty added when `hasHighRiskInteraction` is true.
 * Applied AFTER the weighted sum so it cannot be diluted by other signals.
 * Value chosen to push a borderline MEDIUM wallet into HIGH territory.
 */
export const HIGH_RISK_INTERACTION_PENALTY = 40;

// ---------------------------------------------------------------------------
// Default weights
// ---------------------------------------------------------------------------

/**
 * Default scoring weights.  Must sum to 1.0 — enforced by `validateWeights`.
 *
 * Rationale (v0 — update after first back-test):
 *   - walletAgeDays has the highest weight: time is hard to fake on-chain.
 *   - currentBalanceUsd is second: acts as on-chain collateral signal.
 *   - defiActivityVolumeUsd reflects meaningful economic engagement.
 *   - transactionCount is the weakest signal (easily inflated by bots).
 */
export const DEFAULT_WEIGHTS: RiskWeights = {
  transactionCount: 0.15,
  walletAgeDays: 0.35,
  defiActivityVolumeUsd: 0.25,
  currentBalanceUsd: 0.25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamps `value` to the inclusive range [min, max].
 * @internal
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalises a raw input to [0, 1] using the provided ceiling.
 * Values above the ceiling are clamped to 1; negative values to 0.
 * @internal
 */
export function normalise(value: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return clamp(value / ceiling, 0, 1);
}

/**
 * Validates that the provided weights sum to 1.0 (within floating-point
 * tolerance of ±0.001).  Throws if invalid so misconfiguration is caught early.
 */
export function validateWeights(weights: RiskWeights): void {
  const sum =
    weights.transactionCount +
    weights.walletAgeDays +
    weights.defiActivityVolumeUsd +
    weights.currentBalanceUsd;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(
      `RiskWeights must sum to 1.0; got ${sum.toFixed(4)}.  ` +
        'Adjust weight values so they add up to exactly 1.',
    );
  }
}

/**
 * Classifies a numeric risk score into a qualitative {@link RiskTier}.
 *
 * | Score range  | Tier   |
 * |-------------|--------|
 * | [0, 30]     | LOW    |
 * | (30, 60]    | MEDIUM |
 * | (60, 100]   | HIGH   |
 *
 * Note: BLOCKED is determined upstream (before scoring) when
 * `hasHighRiskInteraction` is `true` and the penalty pushes the
 * score above 100, OR can be set directly by the route layer for
 * sanctioned addresses.
 */
export function classifyRiskTier(score: number): RiskTier {
  if (score <= LOW_RISK_THRESHOLD) return 'LOW';
  if (score <= MEDIUM_RISK_THRESHOLD) return 'MEDIUM';
  return 'HIGH';
}

// ---------------------------------------------------------------------------
// Stub scoring function
// ---------------------------------------------------------------------------

/**
 * Computes a risk score and derived credit terms for a single wallet.
 *
 * ## Algorithm (intended — currently stubbed)
 *
 * 1. **Normalise** each continuous input to [0, 1] using the ceiling constants.
 * 2. **Positive score** = weighted sum of normalised signals × 100, then
 *    invert so that a "better" wallet (higher normalised signals) gets a
 *    *lower* (less risky) score:
 *    ```
 *    rawPositive = (
 *      weights.transactionCount    * norm(transactionCount,       TX_COUNT_CEILING)      +
 *      weights.walletAgeDays       * norm(walletAgeDays,          WALLET_AGE_CEILING_DAYS) +
 *      weights.defiActivityVolumeUsd * norm(defiActivityVolumeUsd, DEFI_VOLUME_CEILING_USD) +
 *      weights.currentBalanceUsd   * norm(currentBalanceUsd,      BALANCE_CEILING_USD)
 *    ) * 100;
 *    riskScore = 100 - rawPositive;   // invert: better profile → lower risk score
 *    ```
 * 3. **Penalty**: if `hasHighRiskInteraction` is `true`, add
 *    `HIGH_RISK_INTERACTION_PENALTY` to the score.
 * 4. **Clamp** the final score to [0, 100].
 * 5. **Classify** into a `RiskTier`.
 * 6. **Derive** `creditLimitUsd` and `interestRateBps` from the tier.
 *
 * ## Current status
 * The real engine integration is pending.  This function always returns
 * `isStub: true` and a neutral score of 50 so that downstream code can be
 * developed and tested against a well-typed contract.
 *
 * @param inputs  - Wallet signals to evaluate.
 * @param weights - Optional weight overrides; defaults to {@link DEFAULT_WEIGHTS}.
 * @returns       A fully typed {@link RiskOutput} marked with `isStub: true`.
 */
export function scoreWallet(
  inputs: RiskInputs,
  weights: RiskWeights = DEFAULT_WEIGHTS,
): RiskOutput {
  validateWeights(weights);

  // ------------------------------------------------------------------
  // STUB: Replace the block below with the real algorithm described
  // in the JSDoc above once the risk engine is available.
  // ------------------------------------------------------------------
  const STUB_SCORE = 50; // neutral mid-range score
  const riskScore = STUB_SCORE;
  const riskTier = classifyRiskTier(riskScore);

  const creditLimitMap: Record<RiskTier, number> = {
    LOW: CREDIT_LIMIT_LOW_CENTS,
    MEDIUM: CREDIT_LIMIT_MEDIUM_CENTS,
    HIGH: CREDIT_LIMIT_HIGH_CENTS,
    BLOCKED: CREDIT_LIMIT_BLOCKED_CENTS,
  };

  const rateMap: Record<RiskTier, number> = {
    LOW: RATE_LOW_BPS,
    MEDIUM: RATE_MEDIUM_BPS,
    HIGH: RATE_HIGH_BPS,
    BLOCKED: RATE_BLOCKED_BPS,
  };
  // ------------------------------------------------------------------

  return {
    walletAddress: inputs.walletAddress,
    riskScore,
    creditLimitUsd: creditLimitMap[riskTier],
    interestRateBps: rateMap[riskTier],
    riskTier,
    isStub: true,
  };
}