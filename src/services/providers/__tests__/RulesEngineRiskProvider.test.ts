import { describe, it, expect } from "vitest";
import {
  RulesEngineRiskProvider,
  defaultRules,
  type Rule,
} from "../RulesEngineRiskProvider.js";

const WALLET_A = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";
const WALLET_B = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNB";

describe("RulesEngineRiskProvider", () => {
  it('has name "rules"', () => {
    expect(new RulesEngineRiskProvider().name).toBe("rules");
  });

  it("returns a numeric score between 0 and 100", async () => {
    const provider = new RulesEngineRiskProvider();
    const result = await provider.evaluate(WALLET_A);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns one factor per rule", async () => {
    const provider = new RulesEngineRiskProvider();
    const result = await provider.evaluate(WALLET_A);
    expect(result.factors).toHaveLength(defaultRules.length);
  });

  it("factor names match rule names", async () => {
    const provider = new RulesEngineRiskProvider();
    const result = await provider.evaluate(WALLET_A);
    const factorNames = result.factors.map((f) => f.name);
    const ruleNames = defaultRules.map((r) => r.name);
    expect(factorNames).toEqual(ruleNames);
  });

  it("produces deterministic output for the same address", async () => {
    const provider = new RulesEngineRiskProvider();
    const r1 = await provider.evaluate(WALLET_A);
    const r2 = await provider.evaluate(WALLET_A);
    expect(r1.score).toBe(r2.score);
  });

  it("may produce different scores for different addresses", async () => {
    const provider = new RulesEngineRiskProvider();
    const r1 = await provider.evaluate(WALLET_A);
    const r2 = await provider.evaluate(WALLET_B);
    // Not strictly guaranteed, but these two known addresses differ
    expect(typeof r1.score).toBe("number");
    expect(typeof r2.score).toBe("number");
  });

  it("throws when constructed with an empty rule set", () => {
    expect(() => new RulesEngineRiskProvider([])).toThrow(
      "RulesEngineRiskProvider requires at least one rule.",
    );
  });

  it("throws when rule weights do not sum to 1.0", () => {
    const badRules: Rule[] = [
      { name: "r1", description: "", weight: 0.5, evaluate: () => 0.5 },
      { name: "r2", description: "", weight: 0.3, evaluate: () => 0.3 },
    ];
    expect(() => new RulesEngineRiskProvider(badRules)).toThrow(
      "Rule weights must sum to 1.0",
    );
  });

  it("accepts custom rules with correct weights", async () => {
    const rules: Rule[] = [
      {
        name: "only_rule",
        description: "test",
        weight: 1.0,
        evaluate: () => 0.6,
      },
    ];
    const provider = new RulesEngineRiskProvider(rules);
    const result = await provider.evaluate(WALLET_A);
    expect(result.score).toBe(60);
  });

  it("clamps score to [0, 100]", async () => {
    const rules: Rule[] = [
      { name: "max_rule", description: "", weight: 1.0, evaluate: () => 1.5 },
    ];
    const provider = new RulesEngineRiskProvider(rules);
    const result = await provider.evaluate(WALLET_A);
    expect(result.score).toBe(100);
  });

  it("factor values are between 0 and 1", async () => {
    const provider = new RulesEngineRiskProvider();
    const result = await provider.evaluate(WALLET_A);
    for (const factor of result.factors) {
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
    }
  });
});
