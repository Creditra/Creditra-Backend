import type {
  CreateRiskSignalInput,
  RiskSignal,
  RiskSignalRuleId,
  RiskSignalSeverity,
  RiskSignalStatus,
  RiskSignalType,
} from '../../models/RiskSignal.js';
import type { DbClient } from '../../db/client.js';
import type {
  RiskSignalListFilters,
  RiskSignalRepository,
} from '../interfaces/RiskSignalRepository.js';

interface RiskSignalRow {
  id: string;
  signal_type: string;
  rule_id: string;
  severity: string;
  wallet_address: string;
  credit_line_id: string | null;
  correlation_id: string;
  thresholds: Record<string, number | string | boolean> | string;
  evidence: Record<string, unknown> | string;
  status: string;
  created_at: Date;
}

/**
 * Postgres-backed RiskSignalRepository for the `risk_signals` table
 * (see `migrations/006_risk_signals.sql`).
 */
export class PostgresRiskSignalRepository implements RiskSignalRepository {
  constructor(private readonly client: DbClient) {}

  async create(input: CreateRiskSignalInput): Promise<RiskSignal> {
    const result = await this.client.query(
      `INSERT INTO risk_signals
         (signal_type, rule_id, severity, wallet_address, credit_line_id,
          correlation_id, thresholds, evidence, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       RETURNING id, signal_type, rule_id, severity, wallet_address, credit_line_id,
                 correlation_id, thresholds, evidence, status, created_at`,
      [
        input.signalType,
        input.ruleId,
        input.severity,
        input.walletAddress,
        input.creditLineId,
        input.correlationId,
        JSON.stringify(input.thresholds ?? {}),
        JSON.stringify(input.evidence ?? {}),
        input.status ?? 'open',
      ],
    );
    return this.toModel(result.rows[0] as RiskSignalRow);
  }

  async findById(id: string): Promise<RiskSignal | null> {
    const result = await this.client.query(
      `SELECT id, signal_type, rule_id, severity, wallet_address, credit_line_id,
              correlation_id, thresholds, evidence, status, created_at
       FROM risk_signals
       WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return this.toModel(result.rows[0] as RiskSignalRow);
  }

  async findMany(filters: RiskSignalListFilters = {}): Promise<RiskSignal[]> {
    const { clause, values, nextIndex } = this.buildWhere(filters);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    values.push(limit, offset);
    const result = await this.client.query(
      `SELECT id, signal_type, rule_id, severity, wallet_address, credit_line_id,
              correlation_id, thresholds, evidence, status, created_at
       FROM risk_signals
       ${clause}
       ORDER BY created_at DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      values,
    );
    return (result.rows as RiskSignalRow[]).map((row) => this.toModel(row));
  }

  async count(
    filters: Omit<RiskSignalListFilters, 'offset' | 'limit'> = {},
  ): Promise<number> {
    const { clause, values } = this.buildWhere(filters);
    const result = await this.client.query(
      `SELECT COUNT(*)::text AS count FROM risk_signals ${clause}`,
      values,
    );
    const row = result.rows[0] as { count: string };
    return Number.parseInt(row.count, 10);
  }

  private buildWhere(
    filters: Omit<RiskSignalListFilters, 'offset' | 'limit'>,
  ): { clause: string; values: unknown[]; nextIndex: number } {
    const parts: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (filters.walletAddress) {
      parts.push(`wallet_address = $${i++}`);
      values.push(filters.walletAddress);
    }
    if (filters.creditLineId) {
      parts.push(`credit_line_id = $${i++}`);
      values.push(filters.creditLineId);
    }
    if (filters.signalType) {
      parts.push(`signal_type = $${i++}`);
      values.push(filters.signalType);
    }
    if (filters.status) {
      parts.push(`status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.correlationId) {
      parts.push(`correlation_id = $${i++}`);
      values.push(filters.correlationId);
    }

    return {
      clause: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '',
      values,
      nextIndex: i,
    };
  }

  private toModel(row: RiskSignalRow): RiskSignal {
    return {
      id: row.id,
      signalType: row.signal_type as RiskSignalType,
      ruleId: row.rule_id as RiskSignalRuleId,
      severity: row.severity as RiskSignalSeverity,
      walletAddress: row.wallet_address,
      creditLineId: row.credit_line_id ?? '',
      correlationId: row.correlation_id,
      thresholds: this.parseJsonObject(row.thresholds) as Record<
        string,
        number | string | boolean
      >,
      evidence: this.parseJsonObject(row.evidence),
      status: row.status as RiskSignalStatus,
      createdAt: new Date(row.created_at),
    };
  }

  private parseJsonObject(
    value: Record<string, unknown> | string,
  ): Record<string, unknown> {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
      return {};
    }
    return value ?? {};
  }
}
