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

/** Maximum allowed body size (in bytes) for typical JSON API requests. */
export const MAX_JSON_BODY_BYTES = 1_000_000;
