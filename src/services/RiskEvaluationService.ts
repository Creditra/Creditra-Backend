import { RiskEvaluation, RiskEvaluationRequest, RiskEvaluationResult, RiskFactor } from '../models/RiskEvaluation.js';
import { RiskEvaluationRepository } from '../repositories/interfaces/RiskEvaluationRepository.js';

export class RiskEvaluationService {
  constructor(private riskEvaluationRepository: RiskEvaluationRepository) {}

  async evaluateRisk(request: RiskEvaluationRequest): Promise<RiskEvaluationResult> {
    if (!request.walletAddress) {
      throw new Error('Wallet address is required');
    }

    // Check if we have a valid cached evaluation
    if (!request.forceRefresh) {
      const isValid = await this.riskEvaluationRepository.isValid(request.walletAddress);
      if (isValid) {
        const cached = await this.riskEvaluationRepository.findLatestByWalletAddress(request.walletAddress);
        if (cached) {
          return {
            walletAddress: cached.walletAddress,
            riskScore: cached.riskScore,
            creditLimit: cached.creditLimit,
            interestRateBps: cached.interestRateBps,
            message: 'Using cached risk evaluation'
          };
        }
      }
    }

    // Perform new risk evaluation (placeholder implementation)
    const evaluation = await this.performRiskEvaluation(request.walletAddress);
    
    // Save the evaluation
    await this.riskEvaluationRepository.save(evaluation);

    return {
      walletAddress: evaluation.walletAddress,
      riskScore: evaluation.riskScore,
      creditLimit: evaluation.creditLimit,
      interestRateBps: evaluation.interestRateBps,
      message: 'New risk evaluation completed'
    };
  }

  async getRiskEvaluation(id: string): Promise<RiskEvaluation | null> {
    return await this.riskEvaluationRepository.findById(id);
  }

  async getLatestRiskEvaluation(walletAddress: string): Promise<RiskEvaluation | null> {
    return await this.riskEvaluationRepository.findLatestByWalletAddress(walletAddress);
  }

  async getRiskEvaluationHistory(walletAddress: string, offset?: number, limit?: number): Promise<RiskEvaluation[]> {
    return await this.riskEvaluationRepository.findByWalletAddress(walletAddress, offset, limit);
  }

  async cleanupExpiredEvaluations(): Promise<number> {
    return await this.riskEvaluationRepository.deleteExpired();
  }

  private async performRiskEvaluation(walletAddress: string): Promise<Omit<RiskEvaluation, 'id'>> {
    // Placeholder risk evaluation logic
    // In a real implementation, this would analyze wallet history, transaction patterns, etc.
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    // Mock risk factors
    const factors: RiskFactor[] = [
      {
        name: 'wallet_age',
        value: 0.8,
        weight: 0.3,
        description: 'Age of the wallet in months'
      },
      {
        name: 'transaction_volume',
        value: 0.6,
        weight: 0.4,
        description: 'Historical transaction volume'
      },
      {
        name: 'defi_participation',
        value: 0.7,
        weight: 0.3,
        description: 'Participation in DeFi protocols'
      }
    ];

    // Calculate weighted risk score
    const riskScore = factors.reduce((score, factor) => {
      return score + (factor.value * factor.weight);
    }, 0) * 100;

    // Determine credit limit based on risk score
    const baseCreditLimit = 1000;
    const creditLimit = (baseCreditLimit * (riskScore / 100)).toString();

    // Determine interest rate (higher risk = higher rate)
    const baseRateBps = 500; // 5%
    const riskMultiplier = (100 - riskScore) / 100;
    const interestRateBps = Math.round(baseRateBps + (baseRateBps * (1 - riskMultiplier)));

    return {
      walletAddress,
      riskScore: Math.round(riskScore),
      creditLimit,
      interestRateBps,
      factors,
      evaluatedAt: now,
      expiresAt
    };
  }
}