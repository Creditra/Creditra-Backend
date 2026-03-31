import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateEnv } from "../env.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All env var names touched by the schema — used for save/restore. */
const ENV_KEYS = [
  "DATABASE_URL",
  "API_KEYS",
  "PORT",
  "NODE_ENV",
  "SHUTDOWN_TIMEOUT_MS",
  "HORIZON_URL",
  "CORS_ORIGINS",
  "CONTRACT_IDS",
  "POLL_INTERVAL_MS",
  "HORIZON_START_LEDGER",
  "ADMIN_API_KEY",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

/** Snapshot of env var state before each test. */
let savedEnv: Record<EnvKey, string | undefined>;

/** Sets the minimum set of env vars required to pass full validation. */
function setValidEnv(): void {
  process.env["DATABASE_URL"] =
    "postgresql://user:pass@localhost:5432/creditra";
  process.env["API_KEYS"] = "key-abc123,key-def456";
}

beforeEach(() => {
  savedEnv = {} as Record<EnvKey, string | undefined>;
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("validateEnv — happy path", () => {
  it("succeeds with only required variables set", () => {
    setValidEnv();
    expect(() => validateEnv()).not.toThrow();
  });

  it("returns typed Env object with correct required values", () => {
    setValidEnv();
    const env = validateEnv();

    expect(env.DATABASE_URL).toBe(
      "postgresql://user:pass@localhost:5432/creditra",
    );
    expect(env.API_KEYS).toBe("key-abc123,key-def456");
  });

  it("applies defaults for optional variables", () => {
    setValidEnv();
    const env = validateEnv();

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(30000);
    expect(env.HORIZON_URL).toBe("https://horizon-testnet.stellar.org");
    expect(env.POLL_INTERVAL_MS).toBe(5000);
    expect(env.HORIZON_START_LEDGER).toBe("latest");
  });

  it("coerces PORT from string to number", () => {
    setValidEnv();
    process.env["PORT"] = "8080";
    const env = validateEnv();
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe("number");
  });

  it("coerces SHUTDOWN_TIMEOUT_MS from string to number", () => {
    setValidEnv();
    process.env["SHUTDOWN_TIMEOUT_MS"] = "60000";
    const env = validateEnv();
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(60000);
  });

  it("coerces POLL_INTERVAL_MS from string to number", () => {
    setValidEnv();
    process.env["POLL_INTERVAL_MS"] = "10000";
    const env = validateEnv();
    expect(env.POLL_INTERVAL_MS).toBe(10000);
  });

  it("accepts a custom HORIZON_URL", () => {
    setValidEnv();
    process.env["HORIZON_URL"] = "https://horizon.stellar.org";
    const env = validateEnv();
    expect(env.HORIZON_URL).toBe("https://horizon.stellar.org");
  });

  it("accepts CORS_ORIGINS when provided", () => {
    setValidEnv();
    process.env["CORS_ORIGINS"] = "https://app.example.com";
    const env = validateEnv();
    expect(env.CORS_ORIGINS).toBe("https://app.example.com");
  });

  it("accepts CONTRACT_IDS when provided", () => {
    setValidEnv();
    process.env["CONTRACT_IDS"] = "CAB1,CAB2";
    const env = validateEnv();
    expect(env.CONTRACT_IDS).toBe("CAB1,CAB2");
  });

  it("accepts ADMIN_API_KEY when provided", () => {
    setValidEnv();
    process.env["ADMIN_API_KEY"] = "admin-secret";
    const env = validateEnv();
    expect(env.ADMIN_API_KEY).toBe("admin-secret");
  });

  it("accepts all NODE_ENV values: development, production, test", () => {
    for (const value of ["development", "production", "test"] as const) {
      setValidEnv();
      process.env["NODE_ENV"] = value;
      const env = validateEnv();
      expect(env.NODE_ENV).toBe(value);
    }
  });

  it("accepts HORIZON_START_LEDGER override", () => {
    setValidEnv();
    process.env["HORIZON_START_LEDGER"] = "12345678";
    const env = validateEnv();
    expect(env.HORIZON_START_LEDGER).toBe("12345678");
  });

  it("leaves optional fields undefined when not set", () => {
    setValidEnv();
    const env = validateEnv();
    expect(env.CORS_ORIGINS).toBeUndefined();
    expect(env.CONTRACT_IDS).toBeUndefined();
    expect(env.ADMIN_API_KEY).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DATABASE_URL validation
// ---------------------------------------------------------------------------

describe("validateEnv — DATABASE_URL", () => {
  it("throws when DATABASE_URL is missing", () => {
    process.env["API_KEYS"] = "key-abc123";
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is an empty string", () => {
    process.env["API_KEYS"] = "key-abc123";
    process.env["DATABASE_URL"] = "";
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a valid URL", () => {
    process.env["API_KEYS"] = "key-abc123";
    process.env["DATABASE_URL"] = "not-a-url";
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it("accepts a postgresql:// URL", () => {
    process.env["API_KEYS"] = "key-abc123";
    process.env["DATABASE_URL"] = "postgresql://localhost/mydb";
    expect(() => validateEnv()).not.toThrow();
  });

  it("accepts a postgres:// URL (alias)", () => {
    process.env["API_KEYS"] = "key-abc123";
    process.env["DATABASE_URL"] =
      "postgres://user:pass@db.example.com:5432/prod";
    expect(() => validateEnv()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// API_KEYS validation
// ---------------------------------------------------------------------------

describe("validateEnv — API_KEYS", () => {
  it("throws when API_KEYS is missing", () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/db";
    expect(() => validateEnv()).toThrow(/API_KEYS/);
  });

  it("throws when API_KEYS is an empty string", () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/db";
    process.env["API_KEYS"] = "";
    expect(() => validateEnv()).toThrow(/API_KEYS/);
  });
});

// ---------------------------------------------------------------------------
// PORT validation
// ---------------------------------------------------------------------------

describe("validateEnv — PORT", () => {
  it("throws when PORT is 0", () => {
    setValidEnv();
    process.env["PORT"] = "0";
    expect(() => validateEnv()).toThrow(/PORT/);
  });

  it("throws when PORT exceeds 65535", () => {
    setValidEnv();
    process.env["PORT"] = "65536";
    expect(() => validateEnv()).toThrow(/PORT/);
  });

  it("throws when PORT is not a number", () => {
    setValidEnv();
    process.env["PORT"] = "not-a-port";
    expect(() => validateEnv()).toThrow(/PORT/);
  });

  it("accepts boundary value PORT=1", () => {
    setValidEnv();
    process.env["PORT"] = "1";
    expect(() => validateEnv()).not.toThrow();
  });

  it("accepts boundary value PORT=65535", () => {
    setValidEnv();
    process.env["PORT"] = "65535";
    expect(() => validateEnv()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// NODE_ENV validation
// ---------------------------------------------------------------------------

describe("validateEnv — NODE_ENV", () => {
  it("throws when NODE_ENV is an unrecognised value", () => {
    setValidEnv();
    process.env["NODE_ENV"] = "staging";
    expect(() => validateEnv()).toThrow(/NODE_ENV/);
  });
});

// ---------------------------------------------------------------------------
// HORIZON_URL validation
// ---------------------------------------------------------------------------

describe("validateEnv — HORIZON_URL", () => {
  it("throws when HORIZON_URL is not a valid URL", () => {
    setValidEnv();
    process.env["HORIZON_URL"] = "horizon-testnet";
    expect(() => validateEnv()).toThrow(/HORIZON_URL/);
  });
});

// ---------------------------------------------------------------------------
// POLL_INTERVAL_MS validation
// ---------------------------------------------------------------------------

describe("validateEnv — POLL_INTERVAL_MS", () => {
  it("throws when POLL_INTERVAL_MS is below 100", () => {
    setValidEnv();
    process.env["POLL_INTERVAL_MS"] = "50";
    expect(() => validateEnv()).toThrow(/POLL_INTERVAL_MS/);
  });

  it("throws when POLL_INTERVAL_MS is not numeric", () => {
    setValidEnv();
    process.env["POLL_INTERVAL_MS"] = "fast";
    expect(() => validateEnv()).toThrow(/POLL_INTERVAL_MS/);
  });
});

// ---------------------------------------------------------------------------
// SHUTDOWN_TIMEOUT_MS validation
// ---------------------------------------------------------------------------

describe("validateEnv — SHUTDOWN_TIMEOUT_MS", () => {
  it("throws when SHUTDOWN_TIMEOUT_MS is negative", () => {
    setValidEnv();
    process.env["SHUTDOWN_TIMEOUT_MS"] = "-1";
    expect(() => validateEnv()).toThrow(/SHUTDOWN_TIMEOUT_MS/);
  });

  it("accepts zero (immediate shutdown)", () => {
    setValidEnv();
    process.env["SHUTDOWN_TIMEOUT_MS"] = "0";
    expect(() => validateEnv()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Error message quality
// ---------------------------------------------------------------------------

describe("validateEnv — error message", () => {
  it("lists all failing fields when both required vars are missing", () => {
    let errorMessage = "";
    try {
      validateEnv();
    } catch (err) {
      errorMessage = (err as Error).message;
    }
    expect(errorMessage).toMatch(/DATABASE_URL/);
    expect(errorMessage).toMatch(/API_KEYS/);
  });

  it("error message references .env.example", () => {
    expect(() => validateEnv()).toThrow(/.env.example/);
  });

  it("error message mentions 'Environment validation failed'", () => {
    expect(() => validateEnv()).toThrow(/Environment validation failed/);
  });
});
