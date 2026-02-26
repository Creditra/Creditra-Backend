import { Router, Request, Response } from "express";
import { createLogger } from '../lib/logger.js';
import { createRequestLogger } from '../middleware/requestLogger.js';
import { evaluateWallet } from "../services/riskService.js";

const router = Router();

const logger = createLogger('risk-router');
router.use(createRequestLogger(logger));

router.post(
  "/evaluate",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.body as { walletAddress?: string };

    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress is required" });
      return;
    }

    try {
      const result = await evaluateWallet(walletAddress);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(400).json({ error: message });
    }
  },
);

export default router;
