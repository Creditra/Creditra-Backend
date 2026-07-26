/**
 * Query-string validation for compliance export endpoints.
 *
 * Enforces required date bounds, max range, pagination ceilings, and
 * allowed format values so overly broad exports are rejected before any
 * repository scan.
 */
import { z } from 'zod';
import { CreditLineStatus } from '../models/CreditLine.js';
import { TransactionStatus, TransactionType } from '../models/Transaction.js';

/** Absolute ceiling on rows returned by a single export request. */
export const MAX_EXPORT_LIMIT = 5_000;

/** Default page size when `limit` is omitted. */
export const DEFAULT_EXPORT_LIMIT = 1_000;

/** Maximum inclusive date range (days) allowed per export. */
export const MAX_EXPORT_RANGE_DAYS = 90;

const isoDateTime = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'must be a valid ISO-8601 timestamp',
  });

const formatSchema = z.enum(['json', 'csv']).default('json');

const limitSchema = z.coerce
  .number()
  .int()
  .min(1, 'limit must be at least 1')
  .max(MAX_EXPORT_LIMIT, `limit must be at most ${MAX_EXPORT_LIMIT}`)
  .default(DEFAULT_EXPORT_LIMIT);

const offsetSchema = z.coerce.number().int().min(0, 'offset must be >= 0').default(0);

/**
 * Shared date-range + pagination + format fields for every export resource.
 * `from` / `to` are required to prevent unbounded historical dumps.
 */
const baseExportQuerySchema = z
  .object({
    format: formatSchema,
    from: isoDateTime,
    to: isoDateTime,
    limit: limitSchema,
    offset: offsetSchema,
  })
  .superRefine((value, ctx) => {
    const fromMs = Date.parse(value.from);
    const toMs = Date.parse(value.to);
    if (fromMs > toMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: '`from` must be less than or equal to `to`',
      });
      return;
    }
    const rangeDays = (toMs - fromMs) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_EXPORT_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `date range must not exceed ${MAX_EXPORT_RANGE_DAYS} days`,
      });
    }
  });

export const creditLineExportQuerySchema = baseExportQuerySchema.and(
  z.object({
    status: z.nativeEnum(CreditLineStatus).optional(),
    walletAddress: z.string().min(1).optional(),
  }),
);

export const transactionExportQuerySchema = baseExportQuerySchema.and(
  z.object({
    status: z.nativeEnum(TransactionStatus).optional(),
    type: z.nativeEnum(TransactionType).optional(),
    creditLineId: z.string().min(1).optional(),
    walletAddress: z.string().min(1).optional(),
  }),
);

export const auditExportQuerySchema = baseExportQuerySchema.and(
  z.object({
    action: z.string().min(1).optional(),
    creditLineId: z.string().min(1).optional(),
  }),
);

export type CreditLineExportQuery = z.infer<typeof creditLineExportQuerySchema>;
export type TransactionExportQuery = z.infer<typeof transactionExportQuerySchema>;
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;
