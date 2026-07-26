/**
 * Shared Zod schemas for cursor-based list query parameters.
 */
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '../utils/constants.js';

/** Coerced positive int in the shared page-size bounds. */
const limitField = z.coerce
  .number()
  .int()
  .min(MIN_PAGE_SIZE)
  .max(MAX_PAGE_SIZE)
  .optional()
  .default(DEFAULT_PAGE_SIZE);

/**
 * Standard cursor pagination query.
 *
 * - `cursor` may be omitted (offset-mode endpoints) or present as empty string
 *   (first page of cursor mode — Express parses `?cursor` as `""`).
 * - `limit` defaults to {@link DEFAULT_PAGE_SIZE}.
 */
export const cursorPaginationQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: limitField,
  })
  .strict();

export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

/** Offset/limit query kept for backward-compatible list endpoints. */
export const offsetPaginationQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).optional().default(0),
    limit: limitField,
  })
  .strict();

export type OffsetPaginationQuery = z.infer<typeof offsetPaginationQuerySchema>;
