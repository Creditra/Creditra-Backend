
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
    return /^G[A-Z2-7]{55}$/.test(address);
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
        throw new Error(
        `Invalid wallet address: "${walletAddress}". ` +
            "Must start with 'G' and be 56 alphanumeric characters.",
        );
    }

    return {
        walletAddress,
        score: null,
        riskLevel: null,
        message: "Risk evaluation placeholder — engine not yet integrated.",
        evaluatedAt: new Date().toISOString(),
    };
}