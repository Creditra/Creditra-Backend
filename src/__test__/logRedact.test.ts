import { afterEach, describe, expect, it } from "vitest";
import {
  isLogRedactionDebugEnabled,
  redactLogArgs,
  redactLogString,
  redactLogValue,
} from "../utils/logRedact.js";

const STELLAR_ADDRESS = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";
const STELLAR_ADDRESS_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNB";
const STELLAR_SECRET_SEED = `S${"A".repeat(55)}`;
const STELLAR_MUXED_ACCOUNT = `M${"B".repeat(68)}`;
const EMAIL = "borrower@example.com";

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

  it("redacts Stellar secret seeds, muxed accounts, and email addresses", () => {
    const input = `${STELLAR_SECRET_SEED} ${STELLAR_MUXED_ACCOUNT} ${EMAIL}`;
    const output = redactLogString(input, false);

    expect(output).toBe("[REDACTED_STELLAR_SECRET] [REDACTED_MUXED_ACCOUNT] [REDACTED_EMAIL]");
    expect(output).not.toContain(STELLAR_SECRET_SEED);
    expect(output).not.toContain(STELLAR_MUXED_ACCOUNT);
    expect(output).not.toContain(EMAIL);
  });

  it("redacts nested objects and arrays", () => {
    const payload = {
      walletAddress: STELLAR_ADDRESS,
      nested: {
        message: `from ${STELLAR_ADDRESS_2} to ${EMAIL}`,
      },
      list: [STELLAR_ADDRESS, STELLAR_SECRET_SEED, STELLAR_MUXED_ACCOUNT],
    };

    const output = redactLogValue(payload, false);

    expect(output.walletAddress).toBe("GCKFBE...EKJA");
    expect(output.nested.message).toBe("from GAAZI4...CWNB to [REDACTED_EMAIL]");
    expect(output.list[0]).toBe("GCKFBE...EKJA");
    expect(output.list[1]).toBe("[REDACTED_STELLAR_SECRET]");
    expect(output.list[2]).toBe("[REDACTED_MUXED_ACCOUNT]");
  });

  it("does not return original cyclic objects during redaction", () => {
    const payload: { walletAddress: string; self?: unknown } = {
      walletAddress: STELLAR_ADDRESS,
    };
    payload.self = payload;

    const output = redactLogValue(payload, false);

    expect(output.walletAddress).toBe("GCKFBE...EKJA");
    expect(output.self).toBe("[Circular]");
    expect(output.self).not.toBe(payload);
  });

  it("redacts cyclic arrays without recursing indefinitely", () => {
    const payload: unknown[] = [STELLAR_ADDRESS];
    payload.push(payload);

    const output = redactLogValue(payload, false);

    expect(output[0]).toBe("GCKFBE...EKJA");
    expect(output[1]).toBe("[Circular]");
  });

  it("redacts Error message and stack", () => {
    const error = new Error(`failed for ${STELLAR_ADDRESS} and ${EMAIL}`);
    error.stack = `Error: failed for ${STELLAR_ADDRESS} and ${STELLAR_SECRET_SEED}`;

    const output = redactLogValue(error, false);

    expect(output.message).toContain("GCKFBE...EKJA");
    expect(output.message).not.toContain(STELLAR_ADDRESS);
    expect(output.message).not.toContain(EMAIL);
    expect(output.stack).toContain("GCKFBE...EKJA");
    expect(output.stack).not.toContain(STELLAR_ADDRESS);
    expect(output.stack).not.toContain(STELLAR_SECRET_SEED);
  });

  it("redacts cyclic Error properties without recursing indefinitely", () => {
    const error = new Error(`failed for ${EMAIL}`);
    (error as Error & { cause?: unknown }).cause = error;

    const output = redactLogValue(error, false) as Error & { cause?: unknown };

    expect(output.message).toBe("failed for [REDACTED_EMAIL]");
    expect(output.cause).toBe("[Circular]");
  });

  it("returns original log args when debug mode is enabled", () => {
    const args = [
      `wallet=${STELLAR_ADDRESS}`,
      { walletAddress: STELLAR_ADDRESS_2, email: EMAIL, seed: STELLAR_SECRET_SEED },
    ];

    const output = redactLogArgs(args, true);

    expect(output).toBe(args);
  });

  it("redacts mixed-type arrays via redactLogArgs", () => {
    const nested = {
      walletAddress: STELLAR_ADDRESS,
      count: 3,
      ok: true,
    };
    const args: unknown[] = [
      `seed=${STELLAR_SECRET_SEED}`,
      nested,
      [STELLAR_MUXED_ACCOUNT, EMAIL, 42],
      null,
      undefined,
      false,
      99,
    ];

    const output = redactLogArgs(args, false);

    expect(output[0]).toBe("seed=[REDACTED_STELLAR_SECRET]");
    expect(output[1]).toEqual({
      walletAddress: "GCKFBE...EKJA",
      count: 3,
      ok: true,
    });
    expect(output[2]).toEqual([
      "[REDACTED_MUXED_ACCOUNT]",
      "[REDACTED_EMAIL]",
      42,
    ]);
    expect(output[3]).toBeNull();
    expect(output[4]).toBeUndefined();
    expect(output[5]).toBe(false);
    expect(output[6]).toBe(99);
    // Structural copy — original nested object is not mutated.
    expect(output[1]).not.toBe(nested);
    expect(nested.walletAddress).toBe(STELLAR_ADDRESS);
  });

  it("passes non-string primitives through redactLogValue unchanged", () => {
    expect(redactLogValue(0, false)).toBe(0);
    expect(redactLogValue(42, false)).toBe(42);
    expect(redactLogValue(true, false)).toBe(true);
    expect(redactLogValue(false, false)).toBe(false);
    expect(redactLogValue(null, false)).toBeNull();
    expect(redactLogValue(undefined, false)).toBeUndefined();
  });

  it("returns primitives and Error references unchanged when debugEnabled is true", () => {
    const err = new Error(`wallet=${STELLAR_ADDRESS}`);
    expect(redactLogValue(err, true)).toBe(err);
    expect(redactLogValue(STELLAR_ADDRESS, true)).toBe(STELLAR_ADDRESS);
    expect(redactLogValue({ a: 1 }, true)).toEqual({ a: 1 });
  });

  it("reads debug mode from LOG_REDACTION_DEBUG including truthy '1' and 'true'", () => {
    process.env.LOG_REDACTION_DEBUG = "true";
    expect(isLogRedactionDebugEnabled()).toBe(true);

    process.env.LOG_REDACTION_DEBUG = "1";
    expect(isLogRedactionDebugEnabled()).toBe(true);

    process.env.LOG_REDACTION_DEBUG = " TRUE ";
    expect(isLogRedactionDebugEnabled()).toBe(true);

    process.env.LOG_REDACTION_DEBUG = "false";
    expect(isLogRedactionDebugEnabled()).toBe(false);

    process.env.LOG_REDACTION_DEBUG = "yes";
    expect(isLogRedactionDebugEnabled()).toBe(false);

    delete process.env.LOG_REDACTION_DEBUG;
    expect(isLogRedactionDebugEnabled()).toBe(false);
  });

  it("bypasses redaction via env for redactLogString and redactLogValue when LOG_REDACTION_DEBUG is set", () => {
    process.env.LOG_REDACTION_DEBUG = "1";
    expect(redactLogString(`wallet=${STELLAR_ADDRESS}`)).toBe(
      `wallet=${STELLAR_ADDRESS}`,
    );
    expect(redactLogValue({ walletAddress: STELLAR_ADDRESS })).toEqual({
      walletAddress: STELLAR_ADDRESS,
    });

    process.env.LOG_REDACTION_DEBUG = "true";
    const args = [STELLAR_SECRET_SEED, EMAIL];
    expect(redactLogArgs(args)).toBe(args);
  });

  it("redacts deeply nested plain objects without mutating the input", () => {
    const input = {
      level1: {
        level2: {
          level3: {
            wallet: STELLAR_ADDRESS,
            note: `contact ${EMAIL}`,
            flags: [true, null, STELLAR_MUXED_ACCOUNT],
          },
        },
      },
    };

    const output = redactLogValue(input, false);

    expect(output.level1.level2.level3.wallet).toBe("GCKFBE...EKJA");
    expect(output.level1.level2.level3.note).toBe("contact [REDACTED_EMAIL]");
    expect(output.level1.level2.level3.flags).toEqual([
      true,
      null,
      "[REDACTED_MUXED_ACCOUNT]",
    ]);
    expect(input.level1.level2.level3.wallet).toBe(STELLAR_ADDRESS);
    expect(input.level1.level2.level3.note).toContain(EMAIL);
  });
});
