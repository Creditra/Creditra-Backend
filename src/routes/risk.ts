import { Router, Request, Response } from "express";
import { createLogger } from '../lib/logger.js';
import { createRequestLogger } from '../middleware/requestLogger.js';
import { evaluateWallet } from "../services/riskService.js";
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();

const logger = createLogger('risk-router');
riskRouter.use(createRequestLogger(logger));

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
