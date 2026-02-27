import { getConnection } from "../../db/client.js";
import type { DependencyStatus } from "../healthService.js";

/** Timeout for the DB ping in milliseconds. */
const DB_PING_TIMEOUT_MS = 2_000;

/**
 * Checks PostgreSQL reachability by running `SELECT 1`.
 * Returns 'down' if DATABASE_URL is not set or the query fails.
 */
export async function checkDatabase(): Promise<DependencyStatus> {
  if (!process.env["DATABASE_URL"]) {
    return { status: "down", error: "DATABASE_URL is not configured" };
  }

  const client = getConnection();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Database ping timed out")),
      DB_PING_TIMEOUT_MS,
    ),
  );

  try {
    if (typeof client.connect === "function") {
      await Promise.race([client.connect(), timeoutPromise]);
    }
    await Promise.race([client.query("SELECT 1"), timeoutPromise]);
    return { status: "ok" };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown database error";
    return { status: "down", error: message };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore cleanup errors
    }
  }
}
