import { z } from 'zod';

/** Schema for POST /api/risk/evaluate */
export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string({ message: 'walletAddress is required' })
    .min(1, 'walletAddress must not be empty')
    .max(256, 'walletAddress must be at most 256 characters'),
  forceRefresh: z.boolean().optional(),
});

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;
