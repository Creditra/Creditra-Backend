import { z } from 'zod';
import { TransactionType } from '../models/Transaction.js';

/**
 * Response (output) Zod schemas — the contract clients rely on.
 * Used by:
 *  - `validateResponse(...)` middleware when ENABLE_RESPONSE_VALIDATION=true
 *  - `assertMatchesSchema(...)` in integration tests
 *
 * Dates may arrive as `Date` (handler → res.json) or ISO strings (HTTP clients).
 */

const dateLike = z.union([z.string(), z.date()]);

/** Shared `{ data, error }` envelope. */
export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z
    .object({
      data: dataSchema.nullable(),
      error: z.string().nullable(),
    })
    .strict();
}

/** Error-only envelope used by fail() / validation failures (details optional). */
export const errorEnvelopeSchema = z
  .object({
    data: z.null(),
    error: z.string(),
    details: z
      .array(
        z
          .object({
            field: z.string(),
            message: z.string(),
          })
          .strict(),
      )
      .optional(),
    retryAfter: z.number().optional(),
  })
  .passthrough();

// ── Domain payloads ──────────────────────────────────────────────────────────

export const creditLineStatusSchema = z.enum(['active', 'suspended', 'closed', 'pending']);

export const creditLineSchema = z
  .object({
    id: z.string().min(1),
    walletAddress: z.string().min(1),
    creditLimit: z.string(),
    availableCredit: z.string().optional(),
    utilized: z.string().optional(),
    currentBalance: z.string().optional(),
    interestRateBps: z.number().int().min(0).max(10_000),
    status: z.union([creditLineStatusSchema, z.string()]),
    version: z.number().int().positive().optional(),
    createdAt: dateLike,
    updatedAt: dateLike,
  })
  .passthrough();

export const creditLinesListDataSchema = z
  .object({
    creditLines: z.array(creditLineSchema),
    pagination: z
      .object({
        total: z.number().int().min(0),
        offset: z.number().int().min(0),
        limit: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const creditLinesCursorDataSchema = z
  .object({
    creditLines: z.array(creditLineSchema),
    pagination: z
      .object({
        limit: z.number().int().positive(),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const walletCreditLinesDataSchema = z
  .object({
    creditLines: z.array(creditLineSchema),
  })
  .strict();

export const drawRepayResultSchema = z
  .object({
    id: z.string().min(1),
    walletAddress: z.string().min(1),
    amount: z.string(),
    txHash: z.string().nullable(),
    status: z.enum(['submitted', 'pending']),
  })
  .strict();

export const transactionSchema = z
  .object({
    id: z.string(),
    creditLineId: z.string(),
    type: z.nativeEnum(TransactionType),
    amount: z.union([z.string(), z.null()]),
    currency: z.union([z.string(), z.null()]),
    timestamp: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const transactionHistoryDataSchema = z
  .object({
    transactions: z.array(transactionSchema),
    total: z.number().int().min(0),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    totalPages: z.number().int().positive(),
  })
  .strict();

export const riskEvaluationResultSchema = z
  .object({
    walletAddress: z.string().min(1),
    riskScore: z.number(),
    creditLimit: z.string(),
    interestRateBps: z.number().int(),
    message: z.string().optional(),
  })
  .passthrough();

export const riskEvaluationSchema = z
  .object({
    id: z.string().min(1),
    walletAddress: z.string().min(1),
    riskScore: z.number(),
    creditLimit: z.string(),
    interestRateBps: z.number().int(),
    factors: z.array(z.unknown()).optional(),
    evaluatedAt: dateLike,
    expiresAt: dateLike.optional(),
  })
  .passthrough();

export const riskHistoryDataSchema = z
  .object({
    evaluations: z.array(riskEvaluationSchema),
  })
  .strict();

export const healthDataSchema = z
  .object({
    status: z.string(),
    service: z.string(),
    ready: z.boolean().optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const reconciliationTriggerDataSchema = z
  .object({
    jobId: z.string(),
    message: z.string(),
  })
  .strict();

export const reconciliationStatusDataSchema = z
  .object({
    workerRunning: z.boolean(),
    queueSize: z.number().int().min(0),
    failedJobs: z.number().int().min(0),
  })
  .strict();

// Enveloped variants for common success paths
export const envelopedCreditLineSchema = apiEnvelopeSchema(creditLineSchema);
export const envelopedCreditLinesListSchema = apiEnvelopeSchema(creditLinesListDataSchema);
export const envelopedWalletCreditLinesSchema = apiEnvelopeSchema(walletCreditLinesDataSchema);
export const envelopedRiskResultSchema = apiEnvelopeSchema(riskEvaluationResultSchema);
export const envelopedRiskEvaluationSchema = apiEnvelopeSchema(riskEvaluationSchema);
export const envelopedRiskHistorySchema = apiEnvelopeSchema(riskHistoryDataSchema);
export const envelopedHealthSchema = apiEnvelopeSchema(healthDataSchema);
export const envelopedDrawRepaySchema = apiEnvelopeSchema(drawRepayResultSchema);
export const envelopedTransactionHistorySchema = apiEnvelopeSchema(transactionHistoryDataSchema);
export const envelopedReconciliationTriggerSchema = apiEnvelopeSchema(
  reconciliationTriggerDataSchema,
);
export const envelopedReconciliationStatusSchema = apiEnvelopeSchema(
  reconciliationStatusDataSchema,
);
