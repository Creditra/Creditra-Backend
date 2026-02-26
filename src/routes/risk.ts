import { Router, Request, Response } from "express";
import { evaluateWallet, InvalidWalletAddressError } from "../services/riskService.js";
import { isValidStellarPublicKey } from "../utils/stellarAddress.js";
import { ok, fail } from "../utils/response.js";

export const riskRouter = Router();

riskRouter.post(
  "/evaluate",
  async (req: Request, res: Response): Promise<void> => {
    const { walletAddress } = req.body as { walletAddress?: string };

    if (typeof walletAddress !== "string" || walletAddress.trim().length === 0) {
      fail(res, "walletAddress is required", 400);
      return;
    }

    const normalizedWalletAddress = walletAddress.trim();
    if (!isValidStellarPublicKey(normalizedWalletAddress)) {
      fail(res, "Invalid wallet address format.", 400);
      return;
    }

    try {
      const result = await evaluateWallet(normalizedWalletAddress);
      ok(res, result);
    } catch (err) {
      if (err instanceof InvalidWalletAddressError) {
        fail(res, err.message, 400);
        return;
      }
      fail(res, "Unable to evaluate wallet at this time.", 500);
    }
  },
);
