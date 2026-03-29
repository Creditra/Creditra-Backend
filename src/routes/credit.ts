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

  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
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

    res.json({
      creditLines,
      pagination: {
        total,
        offset: offsetNum ?? 0,
        limit: limitNum ?? 100,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch credit lines";
    res.status(400).json({ error: message });
  }
});

creditRouter.get("/lines/:id", async (req, res) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(
      req.params.id,
    );

    if (!creditLine) {
      return res
        .status(404)
        .json({ error: "Credit line not found", id: req.params.id });
    }

    return res.json(creditLine);
  } catch {
    return res.status(500).json({ error: "Failed to fetch credit line" });
  }
});

creditRouter.post(
  "/lines",
  validateBody(createCreditLineSchema),
  async (req, res) => {
    try {
      const { walletAddress, requestedLimit } = req.body ?? {};

      if (!walletAddress || !requestedLimit) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const creditLine = await container.creditLineService.createCreditLine({
        walletAddress,
        creditLimit: requestedLimit,
        interestRateBps: 0,
      });

      return res.status(201).json(creditLine);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create credit line";
      return res.status(400).json({ error: message });
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
      return res
        .status(404)
        .json({ error: "Credit line not found", id: req.params.id });
    }

    return res.json(creditLine);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update credit line";
    return res.status(400).json({ error: message });
  }
});

creditRouter.delete("/lines/:id", async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(
      req.params.id,
    );

    if (!deleted) {
      return res
        .status(404)
        .json({ error: "Credit line not found", id: req.params.id });
    }

    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete credit line" });
  }
});

creditRouter.get("/wallet/:walletAddress/lines", async (req, res) => {
  try {
    const creditLines =
      await container.creditLineService.getCreditLinesByWallet(
        req.params.walletAddress,
      );

    res.json({ creditLines });
  } catch {
    res.status(500).json({
      error: "Failed to fetch credit lines for wallet",
    });
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
