import { z } from 'zod';
import { walletAddressSchema } from './common.schema.js';

/** Path params for borrower support lookup. */
export const supportBorrowerParamsSchema = z.object({
  walletAddress: walletAddressSchema,
});

export type SupportBorrowerParams = z.infer<typeof supportBorrowerParamsSchema>;

/** Path params for credit-line support lookup. */
export const supportCreditLineParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export type SupportCreditLineParams = z.infer<typeof supportCreditLineParamsSchema>;

/** Shared query for recent-transaction page size. */
export const supportRecentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type SupportRecentQuery = z.infer<typeof supportRecentQuerySchema>;
