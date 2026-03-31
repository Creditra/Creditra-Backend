import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  evaluateWallet,
  isValidWalletAddress,
  InvalidWalletAddressError,
  scoreToRiskLevel,
  type RiskEvaluationResult,
  type RiskLevel,
} from "../services/riskService.js";
import type { IRiskProvider } from "../services/providers/IRiskProvider.js";

const VALID_ADDRESS =
  "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";

const VALID_ADDRESS_2 =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNB";

function mockProvider(score: number): IRiskProvider {
  return {
    name: "mock",
    evaluate: vi.fn().mockResolvedValue({
      score,
      factors: [{ name: "mock_factor", value: score / 100, weight: 1.0 }],
    }),
  };
}

describe("isValidWalletAddress()", () => {
  it("returns true for a well-formed Stellar address", () => {
    expect(isValidWalletAddress(VALID_ADDRESS)).toBe(true);
  });

  it("returns true for a second valid address", () => {
    expect(isValidWalletAddress(VALID_ADDRESS_2)).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isValidWalletAddress("")).toBe(false);
  });

  it("returns false when address does not start with G", () => {
    const bad = "S" + VALID_ADDRESS.slice(1);
    expect(isValidWalletAddress(bad)).toBe(false);
  });

  it("returns false when address is too short", () => {
    expect(isValidWalletAddress("GSHORT")).toBe(false);
  });

  it("returns false when address is too long", () => {
    expect(isValidWalletAddress(VALID_ADDRESS + "X")).toBe(false);
  });

  it("returns false when address contains lowercase letters", () => {
    const bad = VALID_ADDRESS.slice(0, -1) + "a";
    expect(isValidWalletAddress(bad)).toBe(false);
  });

  it("returns false when address contains invalid characters (0, 1, 8, 9)", () => {
    const bad = "G" + "0".repeat(55);
    expect(isValidWalletAddress(bad)).toBe(false);
  });

  it("returns false for a purely numeric string", () => {
    expect(isValidWalletAddress("1234567890")).toBe(false);
  });

  it("returns false for a plausible but one-char-too-short address", () => {
    expect(isValidWalletAddress(VALID_ADDRESS.slice(0, 55))).toBe(false);
  });
});

describe("scoreToRiskLevel()", () => {
  it("returns 'low' for score 0", () => {
    expect(scoreToRiskLevel(0)).toBe<RiskLevel>("low");
  });

  it("returns 'low' for score 39 (upper boundary of low)", () => {
    expect(scoreToRiskLevel(39)).toBe<RiskLevel>("low");
  });

  it("returns 'medium' for score 40 (lower boundary of medium)", () => {
    expect(scoreToRiskLevel(40)).toBe<RiskLevel>("medium");
  });

  it("returns 'medium' for score 55 (midpoint of medium)", () => {
    expect(scoreToRiskLevel(55)).toBe<RiskLevel>("medium");
  });

  it("returns 'medium' for score 69 (upper boundary of medium)", () => {
    expect(scoreToRiskLevel(69)).toBe<RiskLevel>("medium");
  });

  it("returns 'high' for score 70 (lower boundary of high)", () => {
    expect(scoreToRiskLevel(70)).toBe<RiskLevel>("high");
  });

  it("returns 'high' for score 100", () => {
    expect(scoreToRiskLevel(100)).toBe<RiskLevel>("high");
  });
});

describe("evaluateWallet()", () => {
  describe("with a valid wallet address and mocked provider", () => {
    let result: RiskEvaluationResult;
    let provider: ReturnType<typeof mockProvider>;

    beforeEach(async () => {
      provider = mockProvider(55);
      result = await evaluateWallet(VALID_ADDRESS, provider);
    });

    it("resolves without throwing", async () => {
      await expect(
        evaluateWallet(VALID_ADDRESS, mockProvider(55)),
      ).resolves.toBeDefined();
    });

    it("returns the exact walletAddress that was passed in", () => {
      expect(result.walletAddress).toBe(VALID_ADDRESS);
    });

    it("returns a numeric score from the provider", () => {
      expect(typeof result.score).toBe("number");
      expect(result.score).toBe(55);
    });

    it("maps score to 'medium' riskLevel", () => {
      expect(result.riskLevel).toBe<RiskLevel>("medium");
    });

    it("returns 'low' riskLevel for score < 40", async () => {
      const r = await evaluateWallet(VALID_ADDRESS, mockProvider(20));
      expect(r.riskLevel).toBe<RiskLevel>("low");
    });

    it("returns 'high' riskLevel for score >= 70", async () => {
      const r = await evaluateWallet(VALID_ADDRESS, mockProvider(80));
      expect(r.riskLevel).toBe<RiskLevel>("high");
    });

    it("returns a non-empty message string", () => {
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    });

    it("includes the provider name in the message", () => {
      expect(result.message).toContain("mock");
    });

    it("returns a valid ISO-8601 evaluatedAt timestamp", () => {
      const date = new Date(result.evaluatedAt);
      expect(date.getTime()).not.toBeNaN();
    });

    it("returns an evaluatedAt timestamp close to the current time", () => {
      const diff = Date.now() - new Date(result.evaluatedAt).getTime();
      expect(diff).toBeGreaterThanOrEqual(0);
      expect(diff).toBeLessThan(5000);
    });

    it("result has exactly the expected shape", () => {
      const keys = Object.keys(result).sort();
      expect(keys).toEqual(
        [
          "evaluatedAt",
          "message",
          "riskLevel",
          "score",
          "walletAddress",
        ].sort(),
      );
    });

    it("calls provider.evaluate exactly once with the wallet address", () => {
      expect(provider.evaluate).toHaveBeenCalledWith(VALID_ADDRESS);
      expect(provider.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe("with a second valid address", () => {
    it("reflects the correct walletAddress in the result", async () => {
      const result = await evaluateWallet(VALID_ADDRESS_2, mockProvider(60));
      expect(result.walletAddress).toBe(VALID_ADDRESS_2);
    });
  });

  describe("with an invalid wallet address", () => {
    it("throws an Error for an empty string", async () => {
      await expect(evaluateWallet("")).rejects.toThrow(Error);
    });

    it("throws InvalidWalletAddressError", async () => {
      await expect(evaluateWallet("INVALID")).rejects.toThrow(
        InvalidWalletAddressError,
      );
    });

    it("throws for an address that does not start with G", async () => {
      const bad = "S" + VALID_ADDRESS.slice(1);
      await expect(evaluateWallet(bad)).rejects.toThrow(Error);
    });

    it("throws for an address that is too short", async () => {
      await expect(evaluateWallet("GSHORT")).rejects.toThrow(Error);
    });

    it("throws for an address that is too long", async () => {
      await expect(evaluateWallet(VALID_ADDRESS + "X")).rejects.toThrow(Error);
    });

    it("returns a safe error message without echoing the input", async () => {
      await expect(evaluateWallet("BAD")).rejects.toThrow(
        "Invalid wallet address format.",
      );
    });

    it("does not call the provider when address is invalid", async () => {
      const provider = mockProvider(50);
      await expect(evaluateWallet("INVALID", provider)).rejects.toThrow();
      expect(provider.evaluate).not.toHaveBeenCalled();
    });
  });
});
