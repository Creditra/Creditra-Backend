import { RiskEvaluationRepository } from '../db/riskEvaluationRepository.js';
import { getConnection } from '../db/client.js';

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

export interface RiskHistoryEntry {
    id: string;
    riskScore: number;
    riskLevel: RiskLevel;
    suggestedLimit: string;
    interestRateBps: number;
    inputs: Record<string, unknown> | null;
    evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

export function isValidWalletAddress(address: string): boolean {
    return /^G[A-Z2-7]{54}$/.test(address);
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

export async function getRiskHistory(walletAddress: string): Promise<RiskHistoryEntry[]> {
    if (!isValidWalletAddress(walletAddress)) {
        throw new Error(
            `Invalid wallet address: "${walletAddress}". ` +
            "Must start with 'G' and be 56 alphanumeric characters.",
        );
    }

    const db = getConnection();
    try {
        await db.connect?.();
        const repository = new RiskEvaluationRepository(db);
        const records = await repository.findByWalletAddress(walletAddress);
        
        return records.map(record => ({
            id: record.id,
            riskScore: record.riskScore,
            riskLevel: scoreToRiskLevel(record.riskScore),
            suggestedLimit: record.suggestedLimit,
            interestRateBps: record.interestRateBps,
            inputs: record.inputs,
            evaluatedAt: record.evaluatedAt,
        }));
    } finally {
        await db.end();
    }
}