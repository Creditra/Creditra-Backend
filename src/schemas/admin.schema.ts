import { z } from 'zod';

/** POST /api/admin/api-keys */
export const issueApiKeySchema = z
  .object({
    label: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export type IssueApiKeyBody = z.infer<typeof issueApiKeySchema>;

/** POST /api/admin/maintenance */
export const maintenanceToggleSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type MaintenanceToggleBody = z.infer<typeof maintenanceToggleSchema>;

/** POST /api/credit/lines/bulk */
export const bulkCreditLinesSchema = z
  .object({
    rows: z
      .array(z.unknown())
      .min(1, 'rows array is required and must not be empty')
      .max(200, 'Maximum 200 rows per request'),
  })
  .strict();

export type BulkCreditLinesBody = z.infer<typeof bulkCreditLinesSchema>;

/** Query for bulk dry-run */
export const bulkCreditLinesQuerySchema = z
  .object({
    dry_run: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();

export type BulkCreditLinesQuery = z.infer<typeof bulkCreditLinesQuerySchema>;
