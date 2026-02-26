import { Router, Request, Response } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import {
  listCreditLines,
  getCreditLine,
  suspendCreditLine,
  closeCreditLine,
  repayCreditLine,
  CreditLineNotFoundError,
  InvalidTransitionError,
  InvalidRepaymentError,
  RepaymentRequest,
} from "../services/creditService.js";

const router = Router();

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof CreditLineNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidTransitionError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidRepaymentError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}

router.get("/lines", (_req: Request, res: Response): void => {
  res.json({ data: listCreditLines() });
});


router.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params["id"] as string);
  if (!line) {
    res.status(404).json({ error: `Credit line "${req.params["id"]}" not found.` });
    return;
  }
  res.json({ data: line });
});

router.post(
  "/lines/:id/suspend",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = suspendCreditLine(req.params["id"] as string);
      res.json({ data: line, message: "Credit line suspended." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

router.post(
  "/lines/:id/close",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const line = closeCreditLine(req.params["id"] as string);
      res.json({ data: line, message: "Credit line closed." });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

router.post(
  "/lines/:id/repay",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { amount, transactionReference } = req.body as RepaymentRequest;

      if (typeof amount !== "number") {
        res.status(400).json({ error: "Amount is required and must be a number" });
        return;
      }

      const result = repayCreditLine(req.params["id"] as string, {
        amount,
        transactionReference,
      });

      res.json({
        data: result.creditLine,
        message: `Repayment of ${result.repaymentAmount} processed. New utilized amount: ${result.newUtilizedAmount}`
      });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

export default router;
