import { z } from 'zod';

export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .min(1, 'walletAddress is required')
    .max(256, 'walletAddress must be at most 256 characters'),
  forceRefresh: z.boolean().optional(),
}).strict();

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;

export const riskHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export type RiskHistoryQuery = z.infer<typeof riskHistoryQuerySchema>;
