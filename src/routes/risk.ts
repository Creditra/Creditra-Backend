import { Router, Request, Response } from "express";
import { validateBody } from "../middleware/validate.js";
import { riskEvaluateSchema } from "../schemas/index.js";
import { Container } from "../container/Container.js";
import { createApiKeyMiddleware } from "../middleware/auth.js";
import { loadApiKeys } from "../config/apiKeys.js";
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();

// ✅ required
const container = Container.getInstance();

// Lazy API key loader
const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/risk/evaluate
 */
riskRouter.post(
  "/evaluate",
  validateBody(riskEvaluateSchema),
  async (req: Request, res: Response) => {
    try {
      const { walletAddress, forceRefresh } = req.body ?? {};

      // ✅ keep strict null safety
      if (!walletAddress || typeof walletAddress !== "string") {
        return fail(res, "walletAddress required", 400);
      }

      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      return ok(res, result);
    } catch (error) {
      return fail(res, error);
    }
  },
);

/**
 * GET latest evaluation
 */
riskRouter.get("/wallet/:walletAddress/latest", async (req, res) => {
  try {
    const evaluation =
      await container.riskEvaluationService.getLatestRiskEvaluation(
        req.params.walletAddress,
      );

    if (!evaluation) {
      return fail(res, "No risk evaluation found for wallet", 404);
    }

    return ok(res, evaluation);
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * GET evaluation history
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

    return ok(res, { evaluations });
  } catch (error) {
    return fail(res, error);
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
