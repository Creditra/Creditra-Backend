import { Router, Request, Response } from "express";
import { ok, fail } from "../utils/response.js";
import { adminAuth } from "../middleware/adminAuth.js";
import {
  listCreditLines,
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
  drawFromCreditLine
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

creditRouter.get("/lines", (_req: Request, res: Response): void => {
  ok(res, listCreditLines());
});

creditRouter.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params["id"] as string);
  if (!line) {
    fail(res, `Credit line "${req.params["id"]}" not found.`, 404);
    return;
  }
  ok(res, line);
});

creditRouter.post('/lines/:id/draw', (req, res) => {
  const { amount, borrowerId } = req.body;
  const id = req.params.id;

  try {
    const updated = drawFromCreditLine({
      id,
      borrowerId,
      amount,
    });

    res.status(200).json({
      message: 'Draw successful',
      creditLine: updated,
    });
  } catch (err: any) {
    switch (err.message) {
      case 'NOT_FOUND':
        return res.status(404).json({ error: 'Credit line not found' });
      case 'INVALID_STATUS':
        return res.status(400).json({ error: 'Credit line not active' });
      case 'UNAUTHORIZED':
        return res.status(403).json({ error: 'Unauthorized borrower' });
      case 'OVER_LIMIT':
        return res.status(400).json({ error: 'Amount exceeds credit limit' });
      case 'INVALID_AMOUNT':
        return res.status(400).json({ error: 'Invalid amount' });
      default:
        return res.status(500).json({ error: 'Internal server error' });
    }
  }
});
router.post(
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

export default router;
