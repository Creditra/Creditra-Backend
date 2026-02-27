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

<<<<<<< HEAD
creditRouter.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params["id"] as string);
  if (!line) {
    fail(res, `Credit line "${req.params["id"]}" not found.`, 404);
=======

router.get("/lines/:id", (req: Request, res: Response): void => {
  const line = getCreditLine(req.params.id as string);
  if (!line) {
    res.status(404).json({ error: `Credit line "${req.params.id}" not found.` });
>>>>>>> b7964ce (prep)
    return;
  }
  ok(res, line);
});

creditRouter.post(
  "/lines/:id/suspend",
  adminAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
<<<<<<< HEAD
      const line = suspendCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line suspended." });
=======
      const line = suspendCreditLine(req.params.id as string);
      res.json({ data: line, message: "Credit line suspended." });
>>>>>>> b7964ce (prep)
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
<<<<<<< HEAD
      const line = closeCreditLine(req.params["id"] as string);
      ok(res, { line, message: "Credit line closed." });
=======
      const line = closeCreditLine(req.params.id as string);
      res.json({ data: line, message: "Credit line closed." });
>>>>>>> b7964ce (prep)
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);