import type { DependencyStatus } from "../healthService.js";

/**
 * Checks Redis reachability.
 *
 * Currently stubbed: if REDIS_URL is not set the check is skipped (reported as
 * 'ok' with an informational note). Replace the stub body with a real PING
 * once a Redis client library is added to the project.
 */
export async function checkRedis(): Promise<DependencyStatus> {
  const redisUrl = process.env["REDIS_URL"];

  if (!redisUrl) {
    return {
      status: "ok",
      note: "Redis not yet integrated; check skipped.",
    };
  }

  // TODO: replace with actual Redis PING when ioredis / redis client is added
  return {
    status: "ok",
    note: "Redis URL configured; live ping not yet implemented.",
  };
}
