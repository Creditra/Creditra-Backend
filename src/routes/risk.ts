import { Router, Request, Response, NextFunction } from "express";
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress, forceRefresh } = req.body ?? {};

      // ✅ keep strict null safety
      if (!walletAddress || typeof walletAddress !== "string") {
        const validationError = new Error("walletAddress required");
        validationError.name = "ValidationError";
        return next(validationError);
      }

      const result = await container.riskEvaluationService.evaluateRisk({
        walletAddress,
        forceRefresh,
      });

      return ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET latest evaluation
 */
riskRouter.get("/wallet/:walletAddress/latest", async (req, res, next) => {
  try {
    const evaluation =
      await container.riskEvaluationService.getLatestRiskEvaluation(
        req.params.walletAddress,
      );

    if (!evaluation) {
      const notFoundError = new Error("No risk evaluation found for wallet");
      notFoundError.name = "NotFoundError";
      return next(notFoundError);
    }

    return ok(res, evaluation);
  } catch (error) {
    next(error);
  }
});

/**
 * GET evaluation history
 */
riskRouter.get("/wallet/:walletAddress/history", async (req, res, next) => {
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
    next(error);
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
