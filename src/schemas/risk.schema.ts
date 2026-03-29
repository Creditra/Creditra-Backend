import { z } from 'zod';
import { isValidStellarAddress } from '../utils/stellarAddress.js';

export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .refine(isValidStellarAddress, 'walletAddress must be a valid Stellar address'),
});

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;

export const riskHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export type RiskHistoryQuery = z.infer<typeof riskHistoryQuerySchema>;
