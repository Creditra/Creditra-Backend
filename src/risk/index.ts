export type { RiskInputs, RiskOutput, RiskTier, RiskWeights } from './types.js';
export {
  // Constants — normalisation ceilings
  TX_COUNT_CEILING,
  WALLET_AGE_CEILING_DAYS,
  DEFI_VOLUME_CEILING_USD,
  BALANCE_CEILING_USD,
  // Constants — risk tier thresholds
  LOW_RISK_THRESHOLD,
  MEDIUM_RISK_THRESHOLD,
  HIGH_RISK_THRESHOLD,
  // Constants — credit limits (USD cents)
  CREDIT_LIMIT_LOW_CENTS,
  CREDIT_LIMIT_MEDIUM_CENTS,
  CREDIT_LIMIT_HIGH_CENTS,
  CREDIT_LIMIT_BLOCKED_CENTS,
  // Constants — interest rates (bps)
  RATE_LOW_BPS,
  RATE_MEDIUM_BPS,
  RATE_HIGH_BPS,
  RATE_BLOCKED_BPS,
  // Constants — penalty
  HIGH_RISK_INTERACTION_PENALTY,
  // Default weights
  DEFAULT_WEIGHTS,
  // Helpers
  clamp,
  normalise,
  validateWeights,
  classifyRiskTier,
  // Stub scorer
  scoreWallet,
} from './riskModel.js';
export { evaluateRisk } from './riskService.js';