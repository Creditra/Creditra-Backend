/**
 * Environment Variable Validation
 *
 * Validates a subset of `process.env` at startup using Zod.
 * Call `validateEnv()` before the HTTP server binds to ensure
 * misconfiguration fails fast with a clear diagnostic message.
 *
 * Import the `Env` type wherever typed access to env vars is needed.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // ── Required ──────────────────────────────────────────────────────────────

  /** PostgreSQL connection string. Required for the server to function. */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL must not be empty")
    .url(
      "DATABASE_URL must be a valid URL (e.g. postgresql://user:pass@host:5432/dbname)",
    ),

  /**
   * Comma-separated list of valid API keys.
   * Parsed further by loadApiKeys() — validated here only for presence.
   */
  API_KEYS: z
    .string()
    .min(1, "API_KEYS must not be empty — provide at least one key"),

  // ── Optional with defaults ────────────────────────────────────────────────

  /** HTTP server port. Defaults to 3000. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Node environment. Controls CORS fallback behaviour and logging. */
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  /** Graceful shutdown timeout in milliseconds. Defaults to 30 000. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),

  /** Stellar Horizon base URL. Defaults to the public testnet endpoint. */
  HORIZON_URL: z
    .string()
    .url("HORIZON_URL must be a valid URL")
    .default("https://horizon-testnet.stellar.org"),

  // ── Conditionally required ────────────────────────────────────────────────

  /**
   * Comma-separated list of exact browser origins for CORS.
   * Required in production; optional otherwise (falls back to loopback).
   * Detailed structural validation is handled by loadCorsPolicy().
   */
  CORS_ORIGINS: z.string().optional(),

  // ── Fully optional ────────────────────────────────────────────────────────

  /** Comma-separated Soroban contract IDs to watch for events. */
  CONTRACT_IDS: z.string().optional(),

  /** Horizon polling interval in milliseconds. Defaults to 5 000. */
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),

  /** Ledger from which Horizon replay begins. Defaults to "latest". */
  HORIZON_START_LEDGER: z.string().default("latest"),

  /** Admin API key for admin-only endpoints. Optional — 503 when absent. */
  ADMIN_API_KEY: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Exported type
// ---------------------------------------------------------------------------

/** Typed representation of all validated environment variables. */
export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validates `process.env` against the schema and returns a typed `Env` object.
 *
 * Throws a descriptive `Error` listing every validation failure when any
 * required variable is missing or any value is malformed.
 *
 * Call this function **before** the HTTP server starts. In `src/index.ts`
 * place it as the first statement inside the `if (isMain)` block so that
 * tests importing `app` do not trigger validation.
 *
 * @throws {Error} When one or more environment variables fail validation.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  • ${issue.path.join(".")} — ${issue.message}`,
    );
    throw new Error(
      `Environment validation failed:\n${lines.join("\n")}\n\n` +
        "Copy .env.example to .env and fill in the required values before starting the service.",
    );
  }

  return result.data;
}
