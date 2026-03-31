import { z } from 'zod';
import { walletAddressSchema } from './common.schema.js';

export const walletAddressParamSchema = z.object({
  walletAddress: walletAddressSchema,
});
