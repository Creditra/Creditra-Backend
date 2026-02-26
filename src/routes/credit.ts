import { Router, Request, Response } from "express";
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
  CreateCreditLineInput,
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
  if (err instanceof InvalidCreditLineInputError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
}

router.get("/lines", (_req: Request, res: Response): void => {
  res.json({ data: listCreditLines() });
});

router.post("/lines", (req: Request, res: Response): void => {
  try {
    const body = req.body as Partial<CreateCreditLineInput>;

    // Check required fields presence
    if (!body.borrowerId) {
      res.status(400).json({ error: "borrowerId is required" });
      return;
    }
    if (body.initialLimit === undefined || body.initialLimit === null) {
      res.status(400).json({ error: "initialLimit is required" });
      return;
    }
    if (body.interestRateBps === undefined || body.interestRateBps === null) {
      res.status(400).json({ error: "interestRateBps is required" });
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
    res.status(201).json({ data: line });
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params["id"] as string);
  if (!line) {
    res
      .status(404)
      .json({ error: `Credit line "${req.params["id"]}" not found.` });
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

export { router as creditRouter };
export default router;
