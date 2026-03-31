import type {
  RiskEvaluation,
  RiskEvaluationRequest,
  RiskEvaluationResult,
} from "../models/RiskEvaluation.js";
import type { RiskEvaluationRepository } from "../repositories/interfaces/RiskEvaluationRepository.js";
import type { IRiskProvider } from "./providers/IRiskProvider.js";
import { createRiskProvider } from "./providers/providerFactory.js";

export class RiskEvaluationService {
  constructor(
    private riskEvaluationRepository: RiskEvaluationRepository,
    private provider: IRiskProvider = createRiskProvider(),
  ) {}

  async evaluateRisk(
    request: RiskEvaluationRequest,
  ): Promise<RiskEvaluationResult> {
    if (!request.walletAddress) {
      throw new Error("Wallet address is required");
    }

    // Check if we have a valid cached evaluation
    if (!request.forceRefresh) {
      const isValid = await this.riskEvaluationRepository.isValid(
        request.walletAddress,
      );
      if (isValid) {
        const cached =
          await this.riskEvaluationRepository.findLatestByWalletAddress(
            request.walletAddress,
          );
        if (cached) {
          return {
            walletAddress: cached.walletAddress,
            riskScore: cached.riskScore,
            creditLimit: cached.creditLimit,
            interestRateBps: cached.interestRateBps,
            message: "Using cached risk evaluation",
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
      message: "New risk evaluation completed",
    };
  }

  async getRiskEvaluation(id: string): Promise<RiskEvaluation | null> {
    return await this.riskEvaluationRepository.findById(id);
  }

  async getLatestRiskEvaluation(
    walletAddress: string,
  ): Promise<RiskEvaluation | null> {
    return await this.riskEvaluationRepository.findLatestByWalletAddress(
      walletAddress,
    );
  }

  async getRiskEvaluationHistory(
    walletAddress: string,
    offset?: number,
    limit?: number,
  ): Promise<RiskEvaluation[]> {
    return await this.riskEvaluationRepository.findByWalletAddress(
      walletAddress,
      offset,
      limit,
    );
  }

  async cleanupExpiredEvaluations(): Promise<number> {
    return await this.riskEvaluationRepository.deleteExpired();
  }

  private async performRiskEvaluation(
    walletAddress: string,
  ): Promise<Omit<RiskEvaluation, "id">> {
    const { score, factors } = await this.provider.evaluate(walletAddress);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const baseCreditLimit = 1000;
    const creditLimit = ((baseCreditLimit * score) / 100).toFixed(2);

    const baseRateBps = 500;
    const riskMultiplier = (100 - score) / 100;
    const interestRateBps = Math.round(
      baseRateBps + baseRateBps * riskMultiplier,
    );

    return {
      walletAddress,
      riskScore: score,
      creditLimit,
      interestRateBps,
      factors,
      evaluatedAt: now,
      expiresAt,
    };
  }
}
