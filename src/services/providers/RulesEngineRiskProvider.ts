import type { IRiskProvider, RiskProviderOutput } from "./IRiskProvider.js";
import type { RiskFactor } from "../../models/RiskEvaluation.js";

export interface Rule {
  name: string;
  description: string;
  weight: number;
  evaluate(walletAddress: string): number;
}

function addressEntropy(address: string): number {
  const freq: Record<string, number> = {};
  for (const ch of address) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  const len = address.length;
  return Object.values(freq).reduce((h, count) => {
    const p = count / len;
    return h - p * Math.log2(p);
  }, 0);
}

function deterministicHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const defaultRules: Rule[] = [
  {
    name: "address_entropy",
    description: "Entropy of the address character distribution",
    weight: 0.35,
    evaluate(address: string): number {
      const maxEntropy = Math.log2(32);
      return Math.min(addressEntropy(address) / maxEntropy, 1);
    },
  },
  {
    name: "address_hash_spread",
    description: "Uniform hash spread across the address",
    weight: 0.4,
    evaluate(address: string): number {
      const h = deterministicHash(address);
      return (h % 1000) / 1000;
    },
  },
  {
    name: "address_prefix_score",
    description: "Score derived from the leading characters of the address",
    weight: 0.25,
    evaluate(address: string): number {
      const segment = address.slice(1, 9);
      const h = deterministicHash(segment);
      return (h % 500) / 500;
    },
  },
];

export class RulesEngineRiskProvider implements IRiskProvider {
  readonly name = "rules";

  private readonly rules: Rule[];

  constructor(rules: Rule[] = defaultRules) {
    if (rules.length === 0) {
      throw new Error("RulesEngineRiskProvider requires at least one rule.");
    }
    const totalWeight = rules.reduce((sum, r) => sum + r.weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      throw new Error(
        `Rule weights must sum to 1.0, got ${totalWeight.toFixed(3)}.`,
      );
    }
    this.rules = rules;
  }

  async evaluate(walletAddress: string): Promise<RiskProviderOutput> {
    const factors: RiskFactor[] = this.rules.map((rule) => ({
      name: rule.name,
      value: rule.evaluate(walletAddress),
      weight: rule.weight,
      description: rule.description,
    }));

    const score = Math.round(
      factors.reduce((sum, f) => sum + f.value * f.weight, 0) * 100,
    );

    return { score: Math.min(Math.max(score, 0), 100), factors };
  }
}
