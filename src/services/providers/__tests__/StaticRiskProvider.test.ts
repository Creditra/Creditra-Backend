import { describe, it, expect } from "vitest";
import { StaticRiskProvider } from "../StaticRiskProvider.js";

const WALLET = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";

describe("StaticRiskProvider", () => {
  it('has name "static"', () => {
    expect(new StaticRiskProvider().name).toBe("static");
  });

  it("returns default score of 65", async () => {
    const provider = new StaticRiskProvider();
    const result = await provider.evaluate(WALLET);
    expect(result.score).toBe(65);
  });

  it("returns configured score", async () => {
    const provider = new StaticRiskProvider({ score: 42 });
    const result = await provider.evaluate(WALLET);
    expect(result.score).toBe(42);
  });

  it("returns exactly one factor", async () => {
    const result = await new StaticRiskProvider().evaluate(WALLET);
    expect(result.factors).toHaveLength(1);
  });

  it("factor weight is 1.0", async () => {
    const result = await new StaticRiskProvider().evaluate(WALLET);
    expect(result.factors[0].weight).toBe(1.0);
  });

  it("factor value matches score / 100", async () => {
    const provider = new StaticRiskProvider({ score: 80 });
    const result = await provider.evaluate(WALLET);
    expect(result.factors[0].value).toBeCloseTo(0.8);
  });

  it("returns the same score for different wallet addresses", async () => {
    const provider = new StaticRiskProvider({ score: 50 });
    const r1 = await provider.evaluate(WALLET);
    const r2 = await provider.evaluate(
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNB",
    );
    expect(r1.score).toBe(r2.score);
  });
});
