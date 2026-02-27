import { z } from 'zod';

/** Schema for POST /api/credit/lines — create a credit line */
export const createCreditLineSchema = z.object({
  walletAddress: z
    .string({ required_error: 'walletAddress is required' })
    .min(1, 'walletAddress must not be empty')
    .max(256, 'walletAddress must be at most 256 characters'),
  requestedLimit: z
    .string({ required_error: 'requestedLimit is required' })
    .regex(/^\d+(\.\d+)?$/, 'requestedLimit must be a numeric string'),
});

export type CreateCreditLineBody = z.infer<typeof createCreditLineSchema>;

/** Schema for POST /api/credit/lines/:id/draw — draw from a credit line */
export const drawSchema = z.object({
  amount: z
    .string({ required_error: 'amount is required' })
    .regex(/^\d+(\.\d+)?$/, 'amount must be a numeric string'),
});

export type DrawBody = z.infer<typeof drawSchema>;

/** Schema for POST /api/credit/lines/:id/repay — repay a credit line */
export const repaySchema = z.object({
  amount: z
    .string({ required_error: 'amount is required' })
    .regex(/^\d+(\.\d+)?$/, 'amount must be a numeric string'),
});

export type RepayBody = z.infer<typeof repaySchema>;
