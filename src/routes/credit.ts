import { Router, Request, Response } from "express";
import { ok, fail } from "../utils/response.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { creditLines } from "../data/creditLines.js";
import { paginateAndFilter } from "../utils/paginate.js";
import {
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
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
  fail(res, err, 500);
}

// GET /lines — supports pagination & filtering via query params
// ?page=1&pageSize=10&status=active&borrower=alice&sortBy=id&sortDirection=asc
creditRouter.get("/lines", (req: Request, res: Response): void => {
  const result = paginateAndFilter(creditLines, req.query as Record<string, string>);
  ok(res, result);
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