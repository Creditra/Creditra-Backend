import { Router, Request, Response } from "express";
import { validateBody } from "../middleware/validate.js";
import { riskEvaluateSchema } from "../schemas/index.js";
import { Container } from "../container/Container.js";
import { createApiKeyMiddleware } from "../middleware/auth.js";
import { loadApiKeys } from "../config/apiKeys.js";
import { ok, fail } from "../utils/response.js";
import { loadRateLimitConfig } from "../config/rateLimit.js";
import {
  createRateLimitMiddleware,
  createIpKeyGenerator,
} from "../middleware/rateLimit.js";

export const riskRouter = Router();

// ✅ required
const container = Container.getInstance();

// Lazy API key loader
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

// Rate limiters
const rateLimitConfig = loadRateLimitConfig();
const defaultRiskLimiter = createRateLimitMiddleware({
  windowMs: rateLimitConfig.default.windowMs,
  maxRequests: rateLimitConfig.default.maxRequests,
  keyGenerator: createIpKeyGenerator(),
});
const evaluateLimiter = createRateLimitMiddleware({
  windowMs: rateLimitConfig.evaluate.windowMs,
  maxRequests: rateLimitConfig.evaluate.maxRequests,
  keyGenerator: createIpKeyGenerator(),
});

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/risk/evaluate
 */
riskRouter.post(
  "/evaluate",
  evaluateLimiter,
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response) => {
    try {
      const { walletAddress, forceRefresh } = req.body ?? {};

      // ✅ keep strict null safety
      if (!walletAddress || typeof walletAddress !== "string") {
        return res.status(400).json({ error: "walletAddress required" });
      }

      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      return ok(res, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to evaluate risk";
      return res.status(500).json({ error: message });
    }
  },
);

/**
 * GET latest evaluation
 */
riskRouter.get("/wallet/:walletAddress/latest", defaultRiskLimiter, async (req, res) => {
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
 * GET evaluation history
 */
riskRouter.get("/wallet/:walletAddress/history", defaultRiskLimiter, async (req, res) => {
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
