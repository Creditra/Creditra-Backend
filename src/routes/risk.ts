import { Router, Request, Response } from "express";
import { evaluateWallet } from "../services/riskService.js";
import { isFeatureEnabled } from "../utils/featureFlags.js";

const router = Router();

router.post(
  "/evaluate",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.body as { walletAddress?: string };

    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress is required" });
      return;
    }

    try {
      // Experimental Risk Model V2 Logic
      if (isFeatureEnabled('risk_v2')) {
        // For demonstration, let's say V2 returns a specific field or has different threshold
        const result = await evaluateWallet(walletAddress);
        res.json({
          ...result,
          model: 'risk_v2_experimental',
          highPrecision: true
        });
        return;
      }

      // Default Logic
      const result = await evaluateWallet(walletAddress);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(400).json({ error: message });
    }
  },
);

export default router;