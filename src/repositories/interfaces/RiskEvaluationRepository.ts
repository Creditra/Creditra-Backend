import { RiskEvaluation, RiskEvaluationRequest } from '../../models/RiskEvaluation.js';

export interface RiskEvaluationRepository {
  /**
   * Create or update risk evaluation
   */
  save(evaluation: Omit<RiskEvaluation, 'id'>): Promise<RiskEvaluation>;

  /**
   * Find latest risk evaluation for wallet address
   */
  findLatestByWalletAddress(walletAddress: string): Promise<RiskEvaluation | null>;

  /**
   * Find risk evaluation by ID
   */
  findById(id: string): Promise<RiskEvaluation | null>;

  /**
   * Find all risk evaluations for wallet address
   */
  findByWalletAddress(walletAddress: string, offset?: number, limit?: number): Promise<RiskEvaluation[]>;

  /**
   * Delete expired risk evaluations
   */
  deleteExpired(): Promise<number>;

  /**
   * Check if evaluation is still valid (not expired)
   */
  isValid(walletAddress: string): Promise<boolean>;

  /**
   * Get all evaluations with optional pagination
   */
  findAll(offset?: number, limit?: number): Promise<RiskEvaluation[]>;

  /**
   * Get total count of evaluations
   */
  count(): Promise<number>;
}