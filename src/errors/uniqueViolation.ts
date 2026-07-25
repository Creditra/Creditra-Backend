/**
 * Translate database unique-constraint failures into {@link ConflictError}.
 *
 * Postgres reports uniqueness violations as SQLSTATE `23505`. Drivers surface
 * this as `error.code === '23505'` (node-pg). Constraint names are used only
 * to pick a safe resource type — raw constraint text is never returned to
 * clients (it may embed column values in some drivers/logs).
 */
import {
  ConflictError,
  type ConflictResource,
} from './ConflictError.js';

/** node-pg (and Postgres) unique_violation SQLSTATE. */
export const PG_UNIQUE_VIOLATION = '23505';

interface PgLikeError {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

/**
 * Returns true when `err` looks like a Postgres unique constraint violation.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as PgLikeError).code;
  return code === PG_UNIQUE_VIOLATION;
}

/**
 * Map a known constraint name to a public resource type.
 * Unknown constraints fall back to a generic unique_constraint_violation.
 */
function resourceFromConstraint(constraint: string | undefined): ConflictResource | undefined {
  if (!constraint) return undefined;
  const name = constraint.toLowerCase();

  // Order matters: more specific index names first (e.g. credit_lines_*_borrower
  // must not match the generic "borrower" branch).
  if (name.includes('credit_line')) {
    return 'credit_line';
  }
  if (name.includes('risk_evaluation')) {
    return 'risk_evaluation';
  }
  if (name.includes('webhook')) {
    return 'webhook_subscription';
  }
  if (name.includes('events') || name.includes('idempotency')) {
    return 'event';
  }
  if (name.includes('borrower') || name.includes('wallet_address')) {
    return 'borrower';
  }
  return undefined;
}

/**
 * Safe human message per resource — never echoes constraint detail (which can
 * contain the conflicting key value, e.g. a wallet address).
 */
function safeMessage(resource: ConflictResource | undefined): string {
  switch (resource) {
    case 'credit_line':
      return 'A credit line for this resource already exists.';
    case 'risk_evaluation':
      return 'A risk evaluation for this resource already exists.';
    case 'webhook_subscription':
      return 'A webhook subscription for this endpoint already exists.';
    case 'borrower':
      return 'A borrower with this identity already exists.';
    case 'event':
      return 'An event with this idempotency key already exists.';
    default:
      return 'The request conflicts with an existing resource.';
  }
}

/**
 * Convert a unique-constraint error into a {@link ConflictError}.
 * If `err` is not a unique violation, returns `null` so callers can rethrow.
 */
export function conflictFromUniqueViolation(err: unknown): ConflictError | null {
  if (!isUniqueViolation(err)) return null;

  const pg = err as PgLikeError;
  const resource = resourceFromConstraint(pg.constraint);

  return new ConflictError({
    message: safeMessage(resource),
    code: 'unique_constraint_violation',
    resource,
    // Only expose the constraint *family*, never the raw name or detail
    // (detail often looks like `Key (wallet_address)=(G...) already exists.`).
    details: resource ? { reason: 'unique_constraint' } : { reason: 'unique_constraint' },
  });
}

/**
 * Run an async DB operation and rethrow unique violations as ConflictError.
 */
export async function withUniqueConflictMapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const conflict = conflictFromUniqueViolation(err);
    if (conflict) throw conflict;
    throw err;
  }
}
