import { z } from 'zod';

export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .min(1, 'walletAddress is required')
    .max(256, 'walletAddress must be at most 256 characters'),
  forceRefresh: z.boolean().optional(),
});

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;