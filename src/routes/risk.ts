import { Router, Request, Response } from "express";
import { evaluateWallet } from "../services/riskService.js";

const router = Router();
export const riskRouter = router;

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

export default riskRouter;
