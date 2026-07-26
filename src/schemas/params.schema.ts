import { z } from 'zod';
import { walletAddressSchema } from './common.schema.js';

/** Path param: Stellar wallet address. */
export const walletAddressParamSchema = z
  .object({
    walletAddress: walletAddressSchema,
  })
  .strict();

/**
 * Path param: opaque resource id (UUID or product-prefixed ids).
 * Kept permissive on format so existing non-UUID fixtures keep working;
 * empty / missing ids are rejected.
 */
export const idParamSchema = z
  .object({
    id: z.string().min(1, 'id is required').max(128, 'id is too long'),
  })
  .strict();

export type WalletAddressParams = z.infer<typeof walletAddressParamSchema>;
export type IdParams = z.infer<typeof idParamSchema>;
