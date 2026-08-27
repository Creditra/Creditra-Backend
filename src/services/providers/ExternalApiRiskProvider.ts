import type { IRiskProvider, RiskProviderOutput } from "./IRiskProvider.js";
import { CircuitBreaker, UpstreamResiliencePolicy } from "../upstreamResilience.js";

export interface ExternalApiRiskProviderConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

interface ExternalApiResponse {
  score: number;
  factors?: Array<{
    name: string;
    value: number;
    weight: number;
    description?: string;
  }>;
}

export class ExternalApiRiskProvider implements IRiskProvider {
  readonly name = "external";

  private readonly config: Required<ExternalApiRiskProviderConfig>;
  private readonly policy: UpstreamResiliencePolicy;

  constructor(config: ExternalApiRiskProviderConfig) {
    if (!config.baseUrl || !config.apiKey) {
      throw new Error("ExternalApiRiskProvider requires baseUrl and apiKey.");
    }
    this.config = { timeoutMs: 5000, ...config };
    this.policy = new UpstreamResiliencePolicy(
      new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 }),
      { timeoutMs: this.config.timeoutMs, maxRetries: 2 },
    );
  }

  async evaluate(walletAddress: string): Promise<RiskProviderOutput> {
    const result = await this.policy.execute(
      (signal) => fetch(`${this.config.baseUrl}/evaluate`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ walletAddress }),
      }),
      { upstream: "external-risk-provider", safeToRetry: true },
    );
    const response = result.value;

    if (!response.ok) {
      throw new Error(
        `External risk provider returned HTTP ${response.status}.`,
      );
    }

    const data = (await response.json()) as ExternalApiResponse;

    return {
      score: Math.min(Math.max(Math.round(data.score), 0), 100),
      factors: (data.factors ?? []).map((f) => ({
        name: f.name,
        value: f.value,
        weight: f.weight,
        description: f.description,
      })),
    };
  }
}
