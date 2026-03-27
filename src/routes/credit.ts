import { Router, Request, Response } from "express";
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

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }

  fail(res, err);
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

creditRouter.get("/lines", async (req, res) => {
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
    return fail(res, error, 400);
  }
});

creditRouter.get("/lines/:id", async (req, res) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(
      req.params.id,
    );

    if (!creditLine) {
      return fail(res, "Credit line not found", 404);
    }

    return ok(res, creditLine);
  } catch (error) {
    return fail(res, error);
  }
});

creditRouter.post(
  "/lines",
  validateBody(createCreditLineSchema),
  async (req, res) => {
    try {
      const { walletAddress, requestedLimit } = req.body ?? {};

      if (!walletAddress || !requestedLimit) {
        return fail(res, "Missing required fields", 400);
      }

      const creditLine = await container.creditLineService.createCreditLine({
        walletAddress,
        creditLimit: requestedLimit,
        interestRateBps: 0,
      });

      return ok(res, creditLine, 201);
    } catch (error) {
      return fail(res, error, 400);
    }
  },
);

creditRouter.put("/lines/:id", async (req, res) => {
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
      return fail(res, "Credit line not found", 404);
    }

    return ok(res, creditLine);
  } catch (error) {
    return fail(res, error, 400);
  }
});

creditRouter.delete("/lines/:id", async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(
      req.params.id,
    );

    if (!deleted) {
      return fail(res, "Credit line not found", 404);
    }

    return res.status(204).send();
  } catch (error) {
    return fail(res, error);
  }
});

creditRouter.get("/wallet/:walletAddress/lines", async (req, res) => {
  try {
    const creditLines =
      await container.creditLineService.getCreditLinesByWallet(
        req.params.walletAddress,
      );

    return ok(res, { creditLines });
  } catch (error) {
    return fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

creditRouter.post(
  "/lines/:id/suspend",
  requireApiKey,
  async (req: Request, res: Response) => {
    try {
      const { suspendCreditLine } =
        await import("../services/creditService.js");
      const line = suspendCreditLine(req.params.id);
      ok(res, { line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  "/lines/:id/close",
  requireApiKey,
  async (req: Request, res: Response) => {
    try {
      const { closeCreditLine } = await import("../services/creditService.js");
      const line = closeCreditLine(req.params.id);
      ok(res, { line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

export default creditRouter;
