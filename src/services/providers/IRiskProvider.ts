import type { RiskFactor } from "../../models/RiskEvaluation.js";

export interface RiskProviderOutput {
  score: number;
  factors: RiskFactor[];
}

export interface IRiskProvider {
  readonly name: string;
  evaluate(walletAddress: string): Promise<RiskProviderOutput>;
}
