import { describe, expect, it } from "vitest";
import { isValidStellarPublicKey } from "../utils/stellarAddress.js";

const VALID_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";

describe("isValidStellarPublicKey()", () => {
  it("returns true for a valid Stellar public key", () => {
    expect(isValidStellarPublicKey(VALID_ADDRESS)).toBe(true);
  });

  it("returns false for invalid prefix", () => {
    expect(isValidStellarPublicKey(`S${VALID_ADDRESS.slice(1)}`)).toBe(false);
  });

  it("returns false for invalid length", () => {
    expect(isValidStellarPublicKey("GSHORT")).toBe(false);
  });

  it("returns false for invalid base32 characters", () => {
    expect(isValidStellarPublicKey(`G${"0".repeat(55)}`)).toBe(false);
  });
});
