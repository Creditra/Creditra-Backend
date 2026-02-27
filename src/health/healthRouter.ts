import { Router, Request, Response } from "express";
import { ok } from "../utils/response.js";
import { runHealthChecks } from "./healthService.js";

export const healthRouter = Router();

/**
 * GET /health
 *
 * Returns a machine-readable health report for all key dependencies.
 *
 * HTTP status codes:
 *   200 – service is 'ok' or 'degraded' (partially operational)
 *   503 – service is 'down' (one or more critical dependencies unreachable)
 */
healthRouter.get(
  "/health",
  async (_req: Request, res: Response): Promise<void> => {
    const report = await runHealthChecks();

    if (report.status === "down") {
      res.status(503).json({ data: report, error: null });
      return;
    }

    ok(res, report);
  },
);
