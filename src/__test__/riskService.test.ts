
import {
    evaluateWallet,
    isValidWalletAddress,
    InvalidWalletAddressError,
    scoreToRiskLevel,
    type RiskEvaluationResult,
    type RiskLevel,
} from "../services/riskService.js";

const VALID_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";

const VALID_ADDRESS_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNB";


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
        // Base-32 excludes 0, 1, 8, 9
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

// ---------------------------------------------------------------------------
// scoreToRiskLevel()
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// evaluateWallet()
// ---------------------------------------------------------------------------

    describe("evaluateWallet()", () => {
    describe("with a valid wallet address", () => {
        let result: RiskEvaluationResult;

        beforeEach(async () => {
        result = await evaluateWallet(VALID_ADDRESS);
        });

        it("resolves without throwing", async () => {
        await expect(evaluateWallet(VALID_ADDRESS)).resolves.toBeDefined();
        });

        it("returns the exact walletAddress that was passed in", () => {
        expect(result.walletAddress).toBe(VALID_ADDRESS);
        });

        it("returns score as null (placeholder engine)", () => {
        expect(result.score).toBeNull();
        });

        it("returns riskLevel as null (placeholder engine)", () => {
        expect(result.riskLevel).toBeNull();
        });

        it("returns a non-empty message string", () => {
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
        });

        it("includes 'placeholder' in the message to indicate engine status", () => {
        expect(result.message.toLowerCase()).toContain("placeholder");
        });

        it("returns a valid ISO-8601 evaluatedAt timestamp", () => {
        const date = new Date(result.evaluatedAt);
        expect(date.getTime()).not.toBeNaN();
        });

        it("returns an evaluatedAt timestamp close to the current time", () => {
        const diff = Date.now() - new Date(result.evaluatedAt).getTime();
        // Should be within 5 seconds of now
        expect(diff).toBeGreaterThanOrEqual(0);
        expect(diff).toBeLessThan(5000);
        });

        it("result has exactly the expected shape (no extra fields)", () => {
        const keys = Object.keys(result).sort();
        expect(keys).toEqual(
            ["evaluatedAt", "message", "riskLevel", "score", "walletAddress"].sort(),
        );
        });
    });

    describe("with a second valid address", () => {
        it("reflects the correct walletAddress in the result", async () => {
        const result = await evaluateWallet(VALID_ADDRESS_2);
        expect(result.walletAddress).toBe(VALID_ADDRESS_2);
        });
    });

    describe("with an invalid wallet address", () => {
        it("throws an Error for an empty string", async () => {
        await expect(evaluateWallet("")).rejects.toThrow(Error);
        });

        it("throws InvalidWalletAddressError", async () => {
        await expect(evaluateWallet("INVALID")).rejects.toThrow(InvalidWalletAddressError);
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
        await expect(evaluateWallet("BAD")).rejects.toThrow("Invalid wallet address format.");
        });
    });
});
