import { z } from 'zod';
import { isValidStellarAddress } from '../utils/stellarAddress.js';

export const riskEvaluateSchema = z.object({
  walletAddress: z
    .string()
    .refine(isValidStellarAddress, 'walletAddress must be a valid Stellar address'),
});

export type RiskEvaluateBody = z.infer<typeof riskEvaluateSchema>;
