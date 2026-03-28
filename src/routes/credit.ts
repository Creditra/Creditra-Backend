import { Router, Request, Response, NextFunction } from "express";
import { validateBody } from "../middleware/validate.js";
import { createCreditLineSchema } from "../schemas/index.js";
import { Container } from "../container/Container.js";
import { createApiKeyMiddleware } from "../middleware/auth.js";
import { loadApiKeys } from "../config/apiKeys.js";
import { ok, fail } from "../utils/response.js";
import {
  CreditLineNotFoundError,
  type TransactionType,
} from "../services/creditService.js";

export const creditRouter = Router();

// ✅ required
const container = Container.getInstance();

const requireApiKey = createApiKeyMiddleware(() => loadApiKeys());

const VALID_TRANSACTION_TYPES: readonly TransactionType[] = [
  "draw",
  "repayment",
  "status_change",
];

function handleServiceError(err: unknown, _req: Request, _res: Response, next: NextFunction): void {
  next(err);
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

creditRouter.get("/lines", async (req, res, next) => {
  try {
    const { offset, limit } = req.query;

    const offsetNum =
      typeof offset === "string" ? Number.parseInt(offset, 10) : undefined;
    const limitNum =
      typeof limit === "string" ? Number.parseInt(limit, 10) : undefined;

    const creditLines = await container.creditLineService.getAllCreditLines(
      offsetNum,
      limitNum,
    );

    const total = await container.creditLineService.getCreditLineCount();

    return ok(res, {
      creditLines,
      pagination: {
        total,
        offset: offsetNum ?? 0,
        limit: limitNum ?? 100,
      },
    });
  } catch (error) {
    next(error);
  }
});

creditRouter.get("/lines/:id", async (req, res, next) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(
      req.params.id,
    );

    if (!creditLine) {
      const notFoundError = new Error("Credit line not found");
      notFoundError.name = "NotFoundError";
      return next(notFoundError);
    }

    return ok(res, creditLine);
  } catch (error) {
    next(error);
  }
});

creditRouter.post(
  "/lines",
  validateBody(createCreditLineSchema),
  async (req, res, next) => {
    try {
      const { walletAddress, requestedLimit } = req.body ?? {};

      if (!walletAddress || !requestedLimit) {
        const validationError = new Error("Missing required fields");
        validationError.name = "ValidationError";
        return next(validationError);
      }

      const creditLine = await container.creditLineService.createCreditLine({
        walletAddress,
        creditLimit: requestedLimit,
        interestRateBps: 0,
      });

      return res.status(201).json(creditLine);
    } catch (error) {
      next(error);
    }
  },
);

creditRouter.put("/lines/:id", async (req, res, next) => {
  try {
    const { creditLimit, interestRateBps, status } = req.body ?? {};

    const creditLine = await container.creditLineService.updateCreditLine(
      req.params.id,
      {
        creditLimit,
        interestRateBps,
        status,
      },
    );

    if (!creditLine) {
      const notFoundError = new Error("Credit line not found");
      notFoundError.name = "NotFoundError";
      return next(notFoundError);
    }

    return ok(res, creditLine);
  } catch (error) {
    next(error);
  }
});

creditRouter.delete("/lines/:id", async (req, res, next) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(
      req.params.id,
    );

    if (!deleted) {
      const notFoundError = new Error("Credit line not found");
      notFoundError.name = "NotFoundError";
      return next(notFoundError);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

creditRouter.get("/wallet/:walletAddress/lines", async (req, res, next) => {
  try {
    const creditLines =
      await container.creditLineService.getCreditLinesByWallet(
        req.params.walletAddress,
      );

    return ok(res, { creditLines });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

creditRouter.post(
  "/lines/:id/suspend",
  requireApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { suspendCreditLine } =
        await import("../services/creditService.js");
      const line = suspendCreditLine(req.params.id);
      ok(res, { line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, req, res, next);
    }
  },
);

creditRouter.post(
  "/lines/:id/close",
  requireApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { closeCreditLine } = await import("../services/creditService.js");
      const line = closeCreditLine(req.params.id);
      ok(res, { line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, req, res, next);
    }
  },
);

export default creditRouter;
