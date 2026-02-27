import type { DependencyStatus } from "../healthService.js";

/**
 * Checks risk engine reachability.
 *
 * Currently stubbed: if RISK_ENGINE_URL is not set the check is skipped
 * (reported as 'ok' with an informational note). Replace the stub body with
 * an HTTP fetch/ping once the risk engine service is deployed.
 */
export async function checkRiskEngine(): Promise<DependencyStatus> {
  const engineUrl = process.env["RISK_ENGINE_URL"];

  if (!engineUrl) {
    return {
      status: "ok",
      note: "Risk engine not yet integrated; check skipped.",
    };
  }

  // TODO: replace with actual HTTP ping to RISK_ENGINE_URL/health
  return {
    status: "ok",
    note: "Risk engine URL configured; live ping not yet implemented.",
  };
}
