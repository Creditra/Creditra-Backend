import { z } from 'zod';
import { walletAddressSchema } from './common.schema.js';

export const riskEvaluateSchema = z.object({
  walletAddress: walletAddressSchema,
  forceRefresh: z.boolean().optional(),
}).strict();

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;

export const riskHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export type RiskHistoryQuery = z.infer<typeof riskHistoryQuerySchema>;
