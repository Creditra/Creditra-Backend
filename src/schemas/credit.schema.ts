import { z } from "zod";

/** Schema for POST /api/credit/lines — create a credit line */
export const createCreditLineSchema = z.object({
  walletAddress: z
    .string()
    .min(1, 'walletAddress is required')
    .max(256, 'walletAddress must be at most 256 characters'),
  requestedLimit: z
    .string()
    .min(1, 'requestedLimit is required')
    .regex(/^\d+(\.\d+)?$/, 'requestedLimit must be a numeric string'),
});

export type CreateCreditLineBody = z.infer<typeof createCreditLineSchema>;

/** Schema for POST /api/credit/lines/:id/draw — draw from a credit line */
export const drawSchema = z.object({
  amount: z
    .string()
    .min(1, 'amount is required')
    .regex(/^\d+(\.\d+)?$/, 'amount must be a numeric string'),
});

export type DrawBody = z.infer<typeof drawSchema>;

/** Schema for POST /api/credit/lines/:id/repay — repay a credit line */
export const repaySchema = z.object({
  amount: z
    .string()
    .min(1, 'amount is required')
    .regex(/^\d+(\.\d+)?$/, 'amount must be a numeric string'),
});

export type RepayBody = z.infer<typeof repaySchema>;