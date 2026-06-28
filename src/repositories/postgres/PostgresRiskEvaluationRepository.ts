import type { RiskEvaluation, RiskFactor } from '../../models/RiskEvaluation.js';
import type { RiskEvaluationRepository } from '../interfaces/RiskEvaluationRepository.js';
import type { DbClient } from '../../db/client.js';

interface RiskEvaluationRow {
  id: string;
  wallet_address: string;
  risk_score: number;
  suggested_limit: string;
  interest_rate_bps: number;
  inputs: RiskFactor[] | null;
  evaluated_at: Date;
  expires_at: Date | null;
}

/**
 * Postgres-backed RiskEvaluationRepository.
 *
 * Maps the {@link RiskEvaluation} model onto the `risk_evaluations` table
 * (see `migrations/001_initial_schema.sql` + `004_repository_columns.sql`):
 * - `creditLimit`  <-> `suggested_limit` (kept as a NUMERIC-as-string),
 * - `factors`      <-> `inputs` JSONB snapshot,
 * - `expiresAt`    <-> `expires_at`,
 * - `walletAddress` is resolved through the `borrowers` join.
 *
 * All queries are parameterized; monetary columns stay typed as `string`.
 */
export class PostgresRiskEvaluationRepository implements RiskEvaluationRepository {
  constructor(private client: DbClient) {}

  async save(evaluation: Omit<RiskEvaluation, 'id'>): Promise<RiskEvaluation> {
    const borrowerId = await this.ensureBorrower(evaluation.walletAddress);

    const query = `
      INSERT INTO risk_evaluations
        (borrower_id, risk_score, suggested_limit, interest_rate_bps, inputs, evaluated_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, risk_score, suggested_limit, interest_rate_bps, inputs, evaluated_at, expires_at
    `;
    const values = [
      borrowerId,
      evaluation.riskScore,
      evaluation.creditLimit,
      evaluation.interestRateBps,
      JSON.stringify(evaluation.factors ?? []),
      evaluation.evaluatedAt,
      evaluation.expiresAt,
    ];

    const result = await this.client.query(query, values);
    const row = result.rows[0] as Omit<RiskEvaluationRow, 'wallet_address'>;
    return this.toModel({ ...row, wallet_address: evaluation.walletAddress });
  }

  async findLatestByWalletAddress(walletAddress: string): Promise<RiskEvaluation | null> {
    const rows = await this.select('WHERE b.wallet_address = $1', [walletAddress], 'ORDER BY re.evaluated_at DESC LIMIT 1');
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<RiskEvaluation | null> {
    const rows = await this.select('WHERE re.id = $1', [id]);
    return rows[0] ?? null;
  }

  async findByWalletAddress(walletAddress: string, offset = 0, limit = 100): Promise<RiskEvaluation[]> {
    return this.select(
      'WHERE b.wallet_address = $1',
      [walletAddress, limit, offset],
      'ORDER BY re.evaluated_at DESC LIMIT $2 OFFSET $3'
    );
  }

  async deleteExpired(): Promise<number> {
    const result = await this.client.query(
      'DELETE FROM risk_evaluations WHERE expires_at IS NOT NULL AND expires_at < now()'
    );
    return (result as unknown as { rowCount: number }).rowCount ?? 0;
  }

  async isValid(walletAddress: string): Promise<boolean> {
    const latest = await this.findLatestByWalletAddress(walletAddress);
    if (!latest) return false;
    return latest.expiresAt.getTime() > Date.now();
  }

  async findAll(offset = 0, limit = 100): Promise<RiskEvaluation[]> {
    return this.select('', [limit, offset], 'ORDER BY re.evaluated_at DESC LIMIT $1 OFFSET $2');
  }

  async count(): Promise<number> {
    const result = await this.client.query('SELECT COUNT(*) as count FROM risk_evaluations');
    const row = result.rows[0] as { count: string };
    return parseInt(row.count, 10);
  }

  private async select(where: string, values: unknown[], tail = ''): Promise<RiskEvaluation[]> {
    const query = `
      SELECT re.id, b.wallet_address, re.risk_score, re.suggested_limit,
             re.interest_rate_bps, re.inputs, re.evaluated_at, re.expires_at
      FROM risk_evaluations re
      JOIN borrowers b ON re.borrower_id = b.id
      ${where}
      ${tail}
    `;
    const result = await this.client.query(query, values);
    return (result.rows as RiskEvaluationRow[]).map((row) => this.toModel(row));
  }

  private async ensureBorrower(walletAddress: string): Promise<string> {
    const found = await this.client.query('SELECT id FROM borrowers WHERE wallet_address = $1', [walletAddress]);
    if (found.rows.length > 0) {
      return (found.rows[0] as { id: string }).id;
    }
    const created = await this.client.query(
      'INSERT INTO borrowers (wallet_address) VALUES ($1) RETURNING id',
      [walletAddress]
    );
    return (created.rows[0] as { id: string }).id;
  }

  private toModel(row: RiskEvaluationRow): RiskEvaluation {
    return {
      id: row.id,
      walletAddress: row.wallet_address,
      riskScore: row.risk_score,
      creditLimit: row.suggested_limit,
      interestRateBps: row.interest_rate_bps,
      factors: Array.isArray(row.inputs) ? row.inputs : [],
      evaluatedAt: new Date(row.evaluated_at),
      expiresAt: new Date(row.expires_at ?? row.evaluated_at),
    };
  }
}
