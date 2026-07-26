import { randomUUID } from 'crypto';
import type {
  CreateRiskSignalInput,
  RiskSignal,
} from '../../models/RiskSignal.js';
import type {
  RiskSignalListFilters,
  RiskSignalRepository,
} from '../interfaces/RiskSignalRepository.js';

export class InMemoryRiskSignalRepository implements RiskSignalRepository {
  private readonly signals = new Map<string, RiskSignal>();

  async create(input: CreateRiskSignalInput): Promise<RiskSignal> {
    const signal: RiskSignal = {
      id: randomUUID(),
      signalType: input.signalType,
      ruleId: input.ruleId,
      severity: input.severity,
      walletAddress: input.walletAddress,
      creditLineId: input.creditLineId,
      correlationId: input.correlationId,
      thresholds: { ...input.thresholds },
      evidence: { ...input.evidence },
      status: input.status ?? 'open',
      createdAt: new Date(),
    };
    this.signals.set(signal.id, signal);
    return signal;
  }

  async findById(id: string): Promise<RiskSignal | null> {
    return this.signals.get(id) ?? null;
  }

  async findMany(filters: RiskSignalListFilters = {}): Promise<RiskSignal[]> {
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return this.filter(filters)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async count(
    filters: Omit<RiskSignalListFilters, 'offset' | 'limit'> = {},
  ): Promise<number> {
    return this.filter(filters).length;
  }

  /** Test helper. */
  clear(): void {
    this.signals.clear();
  }

  private filter(
    filters: Omit<RiskSignalListFilters, 'offset' | 'limit'>,
  ): RiskSignal[] {
    return Array.from(this.signals.values()).filter((s) => {
      if (filters.walletAddress && s.walletAddress !== filters.walletAddress) {
        return false;
      }
      if (filters.creditLineId && s.creditLineId !== filters.creditLineId) {
        return false;
      }
      if (filters.signalType && s.signalType !== filters.signalType) {
        return false;
      }
      if (filters.status && s.status !== filters.status) {
        return false;
      }
      if (filters.correlationId && s.correlationId !== filters.correlationId) {
        return false;
      }
      return true;
    });
  }
}
