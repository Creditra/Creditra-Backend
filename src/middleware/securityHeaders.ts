/**
 * Applies the global Express security posture:
 * - `trust proxy` (so `req.ip` / rate-limit keys reflect the real client)
 * - Helmet security headers (HSTS, CSP, X-Frame-Options, nosniff, …)
 *
 * Call once during app bootstrap, before routes.
 */

import type { Express } from "express";
import helmet from "helmet";
import {
  loadSecurityPosture,
  type SecurityPosture,
} from "../config/security.js";

/**
 * Configure trust-proxy and register Helmet middleware on `app`.
 * Returns the resolved posture so callers can log or assert it in tests.
 */
export function applySecurityPosture(
  app: Express,
  posture: SecurityPosture = loadSecurityPosture(),
): SecurityPosture {
  app.set("trust proxy", posture.trustProxy);
  app.use(helmet(posture.helmet));
  return posture;
}
