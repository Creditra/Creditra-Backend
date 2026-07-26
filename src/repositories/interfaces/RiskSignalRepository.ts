import type {
  CreateRiskSignalInput,
  RiskSignal,
  RiskSignalStatus,
  RiskSignalType,
} from '../../models/RiskSignal.js';

export interface RiskSignalListFilters {
  walletAddress?: string;
  creditLineId?: string;
  signalType?: RiskSignalType;
  status?: RiskSignalStatus;
  correlationId?: string;
  offset?: number;
  limit?: number;
}

export interface RiskSignalRepository {
  /** Persist a newly detected signal. */
  create(input: CreateRiskSignalInput): Promise<RiskSignal>;

  /** Fetch by primary key. */
  findById(id: string): Promise<RiskSignal | null>;

  /**
   * List signals newest-first with optional filters.
   * `limit` is clamped by the service layer (default 50, max 100).
   */
  findMany(filters?: RiskSignalListFilters): Promise<RiskSignal[]>;

  /** Total matching rows for pagination metadata. */
  count(filters?: Omit<RiskSignalListFilters, 'offset' | 'limit'>): Promise<number>;
}
