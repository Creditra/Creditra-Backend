import { z } from 'zod';

export const mintServiceTokenSchema = z.object({
  serviceAccount: z.string().min(1).max(128),
  permissions: z.array(z.string().min(1)).max(50).default([]),
  ttlSeconds: z.number().int().min(30).max(3600).optional(),
}).strict();

export type MintServiceTokenBody = z.infer<typeof mintServiceTokenSchema>;
