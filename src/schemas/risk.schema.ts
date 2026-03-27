import { z } from "zod";

/** Schema for POST /api/risk/evaluate */
export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .min(1, "walletAddress is required")
    .max(256, "walletAddress must be at most 256 characters"),
  /** When true, bypass the TTL cache and force a fresh evaluation */
  forceRefresh: z.boolean().optional(),
});

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;
