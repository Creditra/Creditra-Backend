import type { IRiskProvider, RiskProviderOutput } from "./IRiskProvider.js";

export interface StaticRiskProviderOptions {
  score?: number;
}

export class StaticRiskProvider implements IRiskProvider {
  readonly name = "static";

  private readonly fixedScore: number;

  constructor(options: StaticRiskProviderOptions = {}) {
    this.fixedScore = options.score ?? 65;
  }

  async evaluate(_walletAddress: string): Promise<RiskProviderOutput> {
    return {
      score: this.fixedScore,
      factors: [
        {
          name: "static_baseline",
          value: this.fixedScore / 100,
          weight: 1.0,
          description: "Fixed baseline score for all addresses",
        },
      ],
    };
  }
}
