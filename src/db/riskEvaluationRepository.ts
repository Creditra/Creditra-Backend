import { DbClient } from './client.js';

export interface RiskEvaluationRecord {
  id: string;
  borrowerId: string;
  walletAddress: string;
  riskScore: number;
  suggestedLimit: string;
  interestRateBps: number;
  inputs: Record<string, unknown> | null;
  evaluatedAt: string;
}

export interface CreateRiskEvaluationParams {
  walletAddress: string;
  riskScore: number;
  suggestedLimit: string;
  interestRateBps: number;
  inputs?: Record<string, unknown>;
}

export class RiskEvaluationRepository {
  constructor(private db: DbClient) {}

  async create(params: CreateRiskEvaluationParams): Promise<RiskEvaluationRecord> {
    // First, ensure borrower exists or create it
    const borrowerResult = await this.db.query(
      `INSERT INTO borrowers (wallet_address)
       VALUES ($1)
       ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
       RETURNING id, wallet_address`,
      [params.walletAddress]
    );

    const borrower = borrowerResult.rows[0] as { id: string; wallet_address: string };

    // Insert risk evaluation
    const result = await this.db.query(
      `INSERT INTO risk_evaluations (borrower_id, risk_score, suggested_limit, interest_rate_bps, inputs)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, borrower_id, risk_score, suggested_limit, interest_rate_bps, inputs, evaluated_at`,
      [
        borrower.id,
        params.riskScore,
        params.suggestedLimit,
        params.interestRateBps,
        params.inputs ? JSON.stringify(params.inputs) : null,
      ]
    );

    const row = result.rows[0] as {
      id: string;
      borrower_id: string;
      risk_score: number;
      suggested_limit: string;
      interest_rate_bps: number;
      inputs: Record<string, unknown> | null;
      evaluated_at: Date;
    };

    return {
      id: row.id,
      borrowerId: row.borrower_id,
      walletAddress: params.walletAddress,
      riskScore: row.risk_score,
      suggestedLimit: row.suggested_limit,
      interestRateBps: row.interest_rate_bps,
      inputs: row.inputs,
      evaluatedAt: new Date(row.evaluated_at).toISOString(),
    };
  }

  async findByWalletAddress(walletAddress: string): Promise<RiskEvaluationRecord[]> {
    const result = await this.db.query(
      `SELECT 
         re.id,
         re.borrower_id,
         b.wallet_address,
         re.risk_score,
         re.suggested_limit,
         re.interest_rate_bps,
         re.inputs,
         re.evaluated_at
       FROM risk_evaluations re
       JOIN borrowers b ON re.borrower_id = b.id
       WHERE b.wallet_address = $1
       ORDER BY re.evaluated_at DESC`,
      [walletAddress]
    );

    return result.rows.map((row: {
      id: string;
      borrower_id: string;
      wallet_address: string;
      risk_score: number;
      suggested_limit: string;
      interest_rate_bps: number;
      inputs: Record<string, unknown> | null;
      evaluated_at: Date;
    }) => ({
      id: row.id,
      borrowerId: row.borrower_id,
      walletAddress: row.wallet_address,
      riskScore: row.risk_score,
      suggestedLimit: row.suggested_limit,
      interestRateBps: row.interest_rate_bps,
      inputs: row.inputs,
      evaluatedAt: new Date(row.evaluated_at).toISOString(),
    }));
  }
}
