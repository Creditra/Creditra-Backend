import { afterEach, describe, expect, it } from "vitest";
import {
  isLogRedactionDebugEnabled,
  redactLogArgs,
  redactLogString,
  redactLogValue,
} from "../utils/logRedact.js";

const STELLAR_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";
const STELLAR_ADDRESS_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNB";

const originalDebugFlag = process.env.LOG_REDACTION_DEBUG;

afterEach(() => {
  if (originalDebugFlag === undefined) {
    delete process.env.LOG_REDACTION_DEBUG;
  } else {
    process.env.LOG_REDACTION_DEBUG = originalDebugFlag;
  }
});

describe("logRedact", () => {
  it("redacts Stellar addresses inside strings", () => {
    const input = `wallet=${STELLAR_ADDRESS}`;
    const output = redactLogString(input, false);

    expect(output).toBe("wallet=GCKFBE...EKJA");
    expect(output).not.toContain(STELLAR_ADDRESS);
  });

  it("redacts multiple Stellar addresses in one log message", () => {
    const input = `${STELLAR_ADDRESS} -> ${STELLAR_ADDRESS_2}`;
    const output = redactLogString(input, false);

    expect(output).toBe("GCKFBE...EKJA -> GAAZI4...CWNB");
  });

  it("redacts nested objects and arrays", () => {
    const payload = {
      walletAddress: STELLAR_ADDRESS,
      nested: {
        message: `from ${STELLAR_ADDRESS_2}`,
      },
      list: [STELLAR_ADDRESS],
    };

    const output = redactLogValue(payload, false);

    expect(output.walletAddress).toBe("GCKFBE...EKJA");
    expect(output.nested.message).toBe("from GAAZI4...CWNB");
    expect(output.list[0]).toBe("GCKFBE...EKJA");
  });

  it("redacts Error message and stack", () => {
    const error = new Error(`failed for ${STELLAR_ADDRESS}`);
    error.stack = `Error: failed for ${STELLAR_ADDRESS}`;

    const output = redactLogValue(error, false);

    expect(output.message).toContain("GCKFBE...EKJA");
    expect(output.message).not.toContain(STELLAR_ADDRESS);
    expect(output.stack).toContain("GCKFBE...EKJA");
    expect(output.stack).not.toContain(STELLAR_ADDRESS);
  });

  it("returns original log args when debug mode is enabled", () => {
    const args = [
      `wallet=${STELLAR_ADDRESS}`,
      { walletAddress: STELLAR_ADDRESS_2 },
    ];

    const output = redactLogArgs(args, true);

    expect(output).toBe(args);
  });

  it("reads debug mode from LOG_REDACTION_DEBUG", () => {
    process.env.LOG_REDACTION_DEBUG = "true";
    expect(isLogRedactionDebugEnabled()).toBe(true);

    process.env.LOG_REDACTION_DEBUG = "1";
    expect(isLogRedactionDebugEnabled()).toBe(true);

    process.env.LOG_REDACTION_DEBUG = "false";
    expect(isLogRedactionDebugEnabled()).toBe(false);
  });
});
