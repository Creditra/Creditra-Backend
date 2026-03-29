import { z } from 'zod';
import { isValidStellarAddress } from '../utils/stellarAddress.js';

const stellarAddressField = z
  .string()
  .refine(isValidStellarAddress, 'walletAddress must be a valid Stellar address');

export const createCreditLineSchema = z.object({
  walletAddress: stellarAddressField,
  requestedLimit: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'requestedLimit must be a numeric string'),
});

export type CreateCreditLineBody = z.infer<typeof createCreditLineSchema>;

export const drawSchema = z.object({
  walletAddress: stellarAddressField,
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'amount must be a numeric string'),
});

export type DrawBody = z.infer<typeof drawSchema>;

export const repaySchema = z.object({
  walletAddress: stellarAddressField,
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'amount must be a numeric string'),
});

export type RepayBody = z.infer<typeof repaySchema>;
