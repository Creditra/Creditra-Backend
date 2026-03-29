export interface RiskEvaluation {
  id: string;
  walletAddress: string;
  riskScore: number; // 0-100 scale
  creditLimit: string;
  interestRateBps: number;
  factors: RiskFactor[];
  evaluatedAt: Date;
  expiresAt: Date;
}

export interface RiskFactor {
  name: string;
  value: number;
  weight: number;
  description?: string;
}

export interface RiskEvaluationRequest {
  walletAddress: string;
  forceRefresh?: boolean;
}

export interface RiskEvaluationResult {
  walletAddress: string;
  riskScore: number;
  creditLimit: string;
  interestRateBps: number;
  message?: string;
}