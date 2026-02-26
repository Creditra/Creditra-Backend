import { Router, type Request, type Response } from "express";
import { ok, fail } from "../utils/response.js";
import { adminAuth } from "../middleware/adminAuth.js";
import {
  listCreditLines,
  getCreditLine,
  createCreditLine,
  suspendCreditLine,
  closeCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
  InvalidCreditLineInputError,
  type CreateCreditLineInput,
} from "../services/creditService.js";

export const creditRouter = Router();

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    fail(res, err.message, 404);
    return;
  }
  if (err instanceof InvalidTransitionError) {
    fail(res, err.message, 409);
    return;
  }
  if (err instanceof InvalidCreditLineInputError) {
    fail(res, err.message, 400);
    return;
  }
  fail(res, err, 500);
}

creditRouter.get("/lines", (_req: Request, res: Response): void => {
  ok(res, listCreditLines());
});

creditRouter.post("/lines", (req: Request, res: Response): void => {
  try {
    const body = req.body as Partial<CreateCreditLineInput>;

    // Check required fields presence
    if (!body.borrowerId) {
      fail(res, "borrowerId is required", 400);
      return;
    }
    if (body.initialLimit === undefined || body.initialLimit === null) {
      fail(res, "initialLimit is required", 400);
      return;
    }
    if (body.interestRateBps === undefined || body.interestRateBps === null) {
      fail(res, "interestRateBps is required", 400);
      return;
    }

    const input: CreateCreditLineInput = {
      borrowerId: body.borrowerId,
      initialLimit: body.initialLimit,
      interestRateBps: body.interestRateBps,
      currency: body.currency,
      riskScore: body.riskScore,
      evaluationId: body.evaluationId,
    };

    const line = createCreditLine(input);
    res.status(201).json({ data: line }); // keep original 201 behavior if possible, or ok(res, line) doesn't support 201
  } catch (err) {
    handleServiceError(err, res);
  }
});

creditRouter.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params["id"] as string);
  if (!line) {
    fail(res, `Credit line "${req.params["id"]}" not found.`, 404);
    return;
  }
  ok(res, line);
});

creditRouter.post(
  "/lines/:id/suspend",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

creditRouter.post(
  "/lines/:id/close",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = closeCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);
