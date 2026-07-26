/**
 * Shared application constants.
 *
 * These values are exported as a starting point for consistent defaults
 * across the API surface. Importing modules should prefer these constants
 * over hard-coded literals so that limits and defaults can evolve in one
 * place.
 */

/** Default page size for list endpoints when no `limit` query is provided. */
export const DEFAULT_PAGE_SIZE = 25;

/** Maximum page size accepted by list endpoints. Requests above this should
 *  be clamped or rejected by validation middleware. */
export const MAX_PAGE_SIZE = 100;

/** Minimum page size accepted by list endpoints. */
export const MIN_PAGE_SIZE = 1;

/** Default cursor pagination batch size. */
export const DEFAULT_CURSOR_BATCH_SIZE = 50;

/**
 * Maximum allowed body size (in bytes) for typical JSON API requests.
 * Prefer `loadBodyLimitConfig()` / `BODY_LIMIT_DEFAULT_BYTES` from
 * `src/config/bodyLimit.ts` for runtime enforcement; this constant remains
 * as a shared default for callers that only need the numeric default.
 */
export const MAX_JSON_BODY_BYTES = 100 * 1024;

/** Higher ceiling for bulk ingest endpoints (bytes). */
export const MAX_JSON_BODY_BULK_BYTES = 1024 * 1024;
