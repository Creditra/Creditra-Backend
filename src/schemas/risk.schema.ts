import { z } from "zod";

/** Schema for POST /api/risk/evaluate */
export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .min(1, "walletAddress is required")
    .max(256, "walletAddress must be at most 256 characters"),
});

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;
