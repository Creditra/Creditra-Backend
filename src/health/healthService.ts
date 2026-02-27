import { checkDatabase } from "./checks/database.js";
import { checkHorizon } from "./checks/horizon.js";
import { checkRedis } from "./checks/redis.js";
import { checkRiskEngine } from "./checks/riskEngine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DependencyStatusValue = "ok" | "degraded" | "down";

export interface DependencyStatus {
  status: DependencyStatusValue;
  error?: string;
  note?: string;
}

export interface HealthReport {
  /** Rolled-up status across all dependencies. */
  status: DependencyStatusValue;
  service: string;
  /** ISO-8601 timestamp of when the checks were run. */
  checkedAt: string;
  dependencies: {
    database: DependencyStatus;
    horizon: DependencyStatus;
    redis: DependencyStatus;
    riskEngine: DependencyStatus;
  };
}

// ---------------------------------------------------------------------------
// Status roll-up logic
// ---------------------------------------------------------------------------

/**
 * Derives a single top-level status from an array of dependency statuses.
 *
 * - 'down'     if any dependency is 'down'
 * - 'degraded' if any dependency is 'degraded' and none are 'down'
 * - 'ok'       otherwise
 */
export function deriveOverallStatus(
  statuses: DependencyStatusValue[],
): DependencyStatusValue {
  if (statuses.some((s) => s === "down")) return "down";
  if (statuses.some((s) => s === "degraded")) return "degraded";
  return "ok";
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Runs all dependency health checks concurrently and returns a consolidated
 * {@link HealthReport}. Individual check failures are captured — a thrown
 * error is surfaced as `{ status: 'down', error: '…' }` so a single broken
 * checker cannot crash the whole health endpoint.
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const [dbResult, horizonResult, redisResult, riskResult] =
    await Promise.allSettled([
      checkDatabase(),
      Promise.resolve(checkHorizon()),
      checkRedis(),
      checkRiskEngine(),
    ]);

  const database = settledToDependencyStatus(dbResult);
  const horizon = settledToDependencyStatus(horizonResult);
  const redis = settledToDependencyStatus(redisResult);
  const riskEngine = settledToDependencyStatus(riskResult);

  const overallStatus = deriveOverallStatus([
    database.status,
    horizon.status,
    redis.status,
    riskEngine.status,
  ]);

  return {
    status: overallStatus,
    service: "creditra-backend",
    checkedAt: new Date().toISOString(),
    dependencies: { database, horizon, redis, riskEngine },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settledToDependencyStatus(
  result: PromiseSettledResult<DependencyStatus>,
): DependencyStatus {
  if (result.status === "fulfilled") {
    return result.value;
  }
  const message =
    result.reason instanceof Error
      ? result.reason.message
      : "Unknown error during health check";
  return { status: "down", error: message };
}
