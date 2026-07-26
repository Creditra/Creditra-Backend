import { z } from 'zod';
import { isValidStellarAddress } from '../utils/stellarAddress.js';

export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .refine(isValidStellarAddress, 'walletAddress must be a valid Stellar address'),
  forceRefresh: z.boolean().optional(),
}).strict();

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;

export const riskHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export type RiskHistoryQuery = z.infer<typeof riskHistoryQuerySchema>;

/** Admin list filters for anomaly risk signals (GET /api/risk/admin/signals). */
export const riskSignalsQuerySchema = z.object({
  walletAddress: z
    .string()
    .refine(isValidStellarAddress, 'walletAddress must be a valid Stellar address')
    .optional(),
  creditLineId: z.string().uuid().optional(),
  signalType: z
    .enum(['rapid_successive_draws', 'draw_burst', 'unusual_repay_pattern'])
    .optional(),
  status: z.enum(['open', 'acknowledged', 'dismissed']).optional(),
  correlationId: z.string().min(1).max(128).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export type RiskSignalsQuery = z.infer<typeof riskSignalsQuerySchema>;
