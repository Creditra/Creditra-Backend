import { isValidStellarPublicKey } from "../utils/stellarAddress.js";
import type { IRiskProvider } from "./providers/IRiskProvider.js";
import { createRiskProvider } from "./providers/providerFactory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";

export interface RiskEvaluationResult {
  walletAddress: string;
  score: number;
  riskLevel: RiskLevel;
  message: string;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

export function isValidWalletAddress(address: string): boolean {
  return isValidStellarPublicKey(address);
}

export class InvalidWalletAddressError extends Error {
  constructor() {
    super("Invalid wallet address format.");
    this.name = "InvalidWalletAddressError";
  }
}

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score < 40) return "low";
  if (score < 70) return "medium";
  return "high";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function evaluateWallet(
  walletAddress: string,
  provider: IRiskProvider = createRiskProvider(),
): Promise<RiskEvaluationResult> {
  if (!isValidWalletAddress(walletAddress)) {
    throw new InvalidWalletAddressError();
  }

  const { score } = await provider.evaluate(walletAddress);
  const riskLevel = scoreToRiskLevel(score);

  return {
    walletAddress,
    score,
    riskLevel,
    message: `Risk evaluation completed via '${provider.name}' provider.`,
    evaluatedAt: new Date().toISOString(),
  };
}
