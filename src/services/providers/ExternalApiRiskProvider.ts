import type { IRiskProvider, RiskProviderOutput } from "./IRiskProvider.js";
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js";

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

  constructor(config: ExternalApiRiskProviderConfig) {
    if (!config.baseUrl || !config.apiKey) {
      throw new Error("ExternalApiRiskProvider requires baseUrl and apiKey.");
    }
    this.config = { timeoutMs: 5000, ...config };
  }

  async evaluate(walletAddress: string): Promise<RiskProviderOutput> {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.config.baseUrl}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ walletAddress }),
        timeouts: {
          connectTimeoutMs: this.config.timeoutMs,
          readTimeoutMs: 0,
        },
        retry: false,
      });
    } catch (err) {
      throw new Error(
        `External risk provider request failed: ${(err as Error).message}`,
      );
    }

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
