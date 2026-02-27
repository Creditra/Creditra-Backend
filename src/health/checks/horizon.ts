import { isRunning, getConfig } from "../../services/horizonListener.js";
import type { DependencyStatus } from "../healthService.js";

/**
 * Reports the health of the Horizon event listener.
 *
 * - 'ok'       – listener is active and polling
 * - 'degraded' – listener has been configured but is currently stopped
 * - 'down'     – listener has never been started / no config present
 */
export function checkHorizon(): DependencyStatus {
  if (isRunning()) {
    return { status: "ok" };
  }

  const config = getConfig();
  if (config !== null) {
    return {
      status: "degraded",
      error: "Horizon listener is configured but not currently running",
    };
  }

  return { status: "down", error: "Horizon listener has not been started" };
}
