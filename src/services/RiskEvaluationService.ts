import type {
  RiskEvaluation,
  RiskEvaluationRequest,
  RiskEvaluationResult,
} from "../models/RiskEvaluation.js";
import type { RiskEvaluationRepository } from "../repositories/interfaces/RiskEvaluationRepository.js";
import type { IRiskProvider } from "./providers/IRiskProvider.js";
import { createRiskProvider } from "./providers/providerFactory.js";

/**
 * Orchestrates risk evaluations: cache check → provider call → persist.
 *
 * The signal-collection pipeline (see `docs/SIGNALS_INGEST.md`) is encapsulated
 * behind {@link IRiskProvider}. Implementations include `RulesEngineRiskProvider`
 * (default, deterministic), `StaticRiskProvider` (tests), and
 * `ExternalApiRiskProvider` (HTTP-pluggable). The provider is injected at
 * construction so tests can swap it without env-var gymnastics.
 *
 * Score-to-economics translation:
 * - `creditLimit = baseCreditLimit (1000) × score / 100`
 * - `interestRateBps = baseRateBps (500) + baseRateBps × (100 − score) / 100`
 *
 * Higher score ⇒ larger limit, lower rate. Pure function of `score`.
 *
 * Cache behaviour: evaluations are TTL'd for 24h via the repository's
 * `isValid` helper. Pass `forceRefresh: true` to bypass.
 */
export class RiskEvaluationService {
  constructor(
    private riskEvaluationRepository: RiskEvaluationRepository,
    private provider: IRiskProvider = createRiskProvider(),
  ) {}

  /**
   * Evaluate risk for `request.walletAddress`. Returns the cached evaluation
   * when one exists and is still valid (unless `forceRefresh` is set).
   * Otherwise calls the configured provider, persists the result, and
   * returns the summary.
   *
   * @throws if `walletAddress` is empty.
   */
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

  /** Fetch a single evaluation by id; `null` if not found. */
  async getRiskEvaluation(id: string): Promise<RiskEvaluation | null> {
    return await this.riskEvaluationRepository.findById(id);
  }

  /** Most recent evaluation for a wallet, regardless of TTL. */
  async getLatestRiskEvaluation(
    walletAddress: string,
  ): Promise<RiskEvaluation | null> {
    return await this.riskEvaluationRepository.findLatestByWalletAddress(
      walletAddress,
    );
  }

  /**
   * Paginated history of evaluations for `walletAddress`. Useful for
   * auditing how a borrower's risk has moved over time.
   *
   * @param offset zero-based row offset
   * @param limit page size (default and ceiling set by the repository)
   */
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

  /**
   * Delete every evaluation whose `expiresAt` has passed. Intended to be
   * called periodically from an operations job; returns the number of
   * rows removed for logging.
   */
  async cleanupExpiredEvaluations(): Promise<number> {
    return await this.riskEvaluationRepository.deleteExpired();
  }

  /**
   * Pull a fresh evaluation from the configured provider, derive the
   * economics (credit limit + interest rate), and stamp expiry 24h out.
   *
   * Pure function of `(provider.evaluate(wallet))`; called only on cache
   * miss or `forceRefresh`. The `factors[]` array returned by the provider
   * is persisted verbatim so the decision is fully auditable.
   */
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
