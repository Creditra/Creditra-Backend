
import { isValidStellarPublicKey } from "../utils/stellarAddress.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";

export interface RiskEvaluationResult {
    walletAddress: string;
    score: number | null;
    riskLevel: RiskLevel | null;
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
    ): Promise<RiskEvaluationResult> {
    if (!isValidWalletAddress(walletAddress)) {
        throw new InvalidWalletAddressError();
    }

    return {
        walletAddress,
        score: null,
        riskLevel: null,
        message: "Risk evaluation placeholder — engine not yet integrated.",
        evaluatedAt: new Date().toISOString(),
    };
}
