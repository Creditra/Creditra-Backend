import { Router, Request, Response } from "express";
import { evaluateWallet, getRiskHistory } from "../services/riskService.js";
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();

riskRouter.post(
  "/evaluate",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.body as { walletAddress?: string };

    if (!walletAddress) {
      fail(res, "walletAddress is required", 400);
      return;
    }

    try {
      const result = await evaluateWallet(walletAddress);
      ok(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fail(res, message, 400);
    }
  },
);

riskRouter.get(
  "/history/:walletAddress",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      fail(res, "walletAddress is required", 400);
      return;
    }

    try {
      const history = await getRiskHistory(walletAddress);
      ok(res, { walletAddress, evaluations: history });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      fail(res, message, 400);
    }
  },
);
