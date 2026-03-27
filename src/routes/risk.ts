import { Router, Request, Response } from "express";
import { riskEvaluateSchema } from "../schemas/index.js";
import { Container } from "../container/Container.js";
import { createApiKeyMiddleware } from "../middleware/auth.js";
import { loadApiKeys } from "../config/apiKeys.js";
import { ok } from "../utils/response.js";

export const riskRouter = Router();

const container = Container.getInstance();

const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/risk/evaluate
 *
 * Evaluate on-chain risk for a wallet. Results are cached with a 24-hour TTL.
 * Pass `forceRefresh: true` to bypass the cache and trigger a fresh evaluation.
 */
riskRouter.post(
  "/evaluate",
  async (req: Request, res: Response) => {
    try {
      const parsed = riskEvaluateSchema.safeParse(req.body);

      if (!parsed.success || !parsed.data.walletAddress) {
        return res.status(400).json({ error: "walletAddress required" });
      }

      const { walletAddress, forceRefresh } = parsed.data;

      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      // Return flat result — consumers read fields directly (no envelope wrapper)
      return res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to evaluate risk";
      return res.status(500).json({ error: message });
    }
  },
);

/**
 * GET /api/risk/evaluations/:id
 *
 * Fetch a stored risk evaluation by its unique ID.
 */
riskRouter.get("/evaluations/:id", async (req: Request, res: Response) => {
  try {
    const evaluation = await container.riskEvaluationService.getRiskEvaluation(
      req.params.id,
    );

    if (!evaluation) {
      return res
        .status(404)
        .json({ error: "Risk evaluation not found", id: req.params.id });
    }

    return res.json(evaluation);
  } catch {
    return res
      .status(500)
      .json({ error: "Failed to fetch risk evaluation" });
  }
});

/**
 * GET /api/risk/wallet/:walletAddress/latest
 *
 * Fetch the most recent risk evaluation for a wallet address.
 */
riskRouter.get("/wallet/:walletAddress/latest", async (req, res) => {
  try {
    const evaluation =
      await container.riskEvaluationService.getLatestRiskEvaluation(
        req.params.walletAddress,
      );

    if (!evaluation) {
      return res
        .status(404)
        .json({ error: "No risk evaluation found for wallet" });
    }

    return res.json(evaluation);
  } catch {
    return res
      .status(500)
      .json({ error: "Failed to fetch latest risk evaluation" });
  }
});

/**
 * GET /api/risk/wallet/:walletAddress/history
 *
 * Fetch paginated evaluation history for a wallet address.
 * Query params: offset (int), limit (int)
 */
riskRouter.get("/wallet/:walletAddress/history", async (req, res) => {
  try {
    const { offset, limit } = req.query;

    const offsetNum =
      typeof offset === "string" ? Number.parseInt(offset, 10) : undefined;
    const limitNum =
      typeof limit === "string" ? Number.parseInt(limit, 10) : undefined;

    const evaluations =
      await container.riskEvaluationService.getRiskEvaluationHistory(
        req.params.walletAddress,
        offsetNum,
        limitNum,
      );

    res.json({ evaluations });
  } catch {
    res.status(500).json({ error: "Failed to fetch risk evaluation history" });
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

riskRouter.post(
  "/admin/recalibrate",
  requireApiKey,
  (_req: Request, res: Response): void => {
    ok(res, { message: "Risk model recalibration triggered" });
  },
);

export default riskRouter;
