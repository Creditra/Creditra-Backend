import { RiskEvaluation } from '../../models/RiskEvaluation.js';
import { RiskEvaluationRepository } from '../interfaces/RiskEvaluationRepository.js';
import { randomUUID } from 'crypto';

export class InMemoryRiskEvaluationRepository implements RiskEvaluationRepository {
  private evaluations: Map<string, RiskEvaluation> = new Map();

  async save(evaluation: Omit<RiskEvaluation, 'id'>): Promise<RiskEvaluation> {
    const id = randomUUID();
    const newEvaluation: RiskEvaluation = {
      id,
      ...evaluation
    };

    this.evaluations.set(id, newEvaluation);
    return newEvaluation;
  }

  async findLatestByWalletAddress(walletAddress: string): Promise<RiskEvaluation | null> {
    const evaluations = Array.from(this.evaluations.values())
      .filter(evaluation => evaluation.walletAddress === walletAddress)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());

    return evaluations[0] || null;
  }

  async findById(id: string): Promise<RiskEvaluation | null> {
    return this.evaluations.get(id) || null;
  }

  async findByWalletAddress(walletAddress: string, offset = 0, limit = 100): Promise<RiskEvaluation[]> {
    const filtered = Array.from(this.evaluations.values())
      .filter(evaluation => evaluation.walletAddress === walletAddress)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());

    return filtered.slice(offset, offset + limit);
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    let deletedCount = 0;

    for (const [id, evaluation] of this.evaluations.entries()) {
      if (evaluation.expiresAt < now) {
        this.evaluations.delete(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  async isValid(walletAddress: string): Promise<boolean> {
    const latest = await this.findLatestByWalletAddress(walletAddress);
    if (!latest) {
      return false;
    }

    return latest.expiresAt > new Date();
  }

  async findAll(offset = 0, limit = 100): Promise<RiskEvaluation[]> {
    const all = Array.from(this.evaluations.values())
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
    
    return all.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.evaluations.size;
  }

  // Helper method for testing
  clear(): void {
    this.evaluations.clear();
  }
}