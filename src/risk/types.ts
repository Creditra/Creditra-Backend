/**
 * RiskTier categorises a wallet's overall credit risk.
 *
 * - LOW    : low default probability; eligible for highest credit limits
 * - MEDIUM : moderate risk; standard credit limits apply
 * - HIGH   : elevated risk; reduced limits and higher rates
 * - BLOCKED: wallet is ineligible for any credit (e.g. sanctions hit)
 */
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

/**
 * Inputs sourced from on-chain and off-chain data feeds.
 * Every field is required so callers must explicitly provide a value;
 * optional signals that are genuinely absent should be represented as
 * 0 / false rather than omitted, which keeps scoring deterministic.
 */
export interface RiskInputs {
  /** Ethereum-format wallet address (0x-prefixed, 42 chars). */
  walletAddress: string;

  /**
   * Total number of on-chain transactions ever sent or received.
   * Higher counts imply longer, richer on-chain history.
   */
  transactionCount: number;

  /**
   * Age of the wallet in days since the first observed transaction.
   * Older wallets are generally considered lower risk.
   */
  walletAgeDays: number;

  /**
   * Cumulative USD volume of DeFi activity (lending, swaps, etc.)
   * over the trailing 90 days. A proxy for engagement and liquidity.
   */
  defiActivityVolumeUsd: number;

  /**
   * Total USD value of assets currently held in the wallet.
   * Serves as an on-chain collateral signal.
   */
  currentBalanceUsd: number;

  /**
   * Whether the wallet has ever interacted with a contract or address
   * flagged as high-risk (e.g. OFAC-sanctioned mixer, exploit contract).
   * A `true` value applies a hard penalty to the final score.
   */
  hasHighRiskInteraction: boolean;
}

/**
 * The output produced by the risk scoring function for a single wallet.
 */
export interface RiskOutput {
  /** Echo of the evaluated wallet address for traceability. */
  walletAddress: string;

  /**
   * Normalised risk score in the range [0, 100].
   * 0 = lowest risk (best credit profile), 100 = highest risk.
   */
  riskScore: number;

  /**
   * Derived maximum credit limit in USD cents (integer).
   * Stored as cents to avoid floating-point rounding on monetary values.
   */
  creditLimitUsd: number;

  /**
   * Annual interest rate expressed in basis points (1 bps = 0.01 %).
   * e.g. 500 bps = 5.00 % APR.
   */
  interestRateBps: number;

  /** Qualitative risk bucket derived from `riskScore`. */
  riskTier: RiskTier;

  /**
   * `true` while the real risk engine is not yet connected.
   * Consumers MUST check this flag and treat the output as non-binding
   * until it is `false`.
   */
  isStub: boolean;
}

/**
 * Relative weights applied to each scoring dimension.
 * All weights MUST sum to exactly 1.0 (validated at runtime).
 *
 * Adjust these values when back-testing against real default data.
 */
export interface RiskWeights {
  /** Weight for transaction count dimension. */
  transactionCount: number;
  /** Weight for wallet age dimension. */
  walletAgeDays: number;
  /** Weight for DeFi activity volume dimension. */
  defiActivityVolumeUsd: number;
  /** Weight for current balance dimension. */
  currentBalanceUsd: number;
}