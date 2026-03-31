import { z } from 'zod';
import { isValidStellarPublicKey } from '../utils/stellarAddress.js';

export const walletAddressSchema = z
  .string()
  .min(1, 'walletAddress is required')
  .refine(isValidStellarPublicKey, 'Invalid Stellar wallet address');
