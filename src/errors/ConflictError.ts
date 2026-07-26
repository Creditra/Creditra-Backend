/**
 * Shared conflict error for duplicate resources and state conflicts.
 *
 * Thrown by services/repositories when a write would violate uniqueness or
 * an invalid concurrent state (duplicate open, version mismatch, etc.).
 * Mapped by {@link sendConflict} / the global error handler to HTTP 409 with
 * RFC 7807 problem+json details.
 *
 * Security: never put wallet addresses, secrets, API keys, or other sensitive
 * identifiers into `message` or `details`. Resource *types* and safe field
 * names are fine; values that identify end-users are not.
 */

/** Stable machine-readable conflict codes clients can branch on. */
export type ConflictCode =
  | 'duplicate_resource'
  | 'version_conflict'
  | 'invalid_state_transition'
  | 'unique_constraint_violation';

/** Resource kinds involved in conflict responses (public taxonomy). */
export type ConflictResource =
  | 'credit_line'
  | 'risk_evaluation'
  | 'webhook_subscription'
  | 'borrower'
  | 'event';

export interface ConflictErrorOptions {
  /** Human-readable, non-sensitive explanation (also used as problem `detail`). */
  message: string;
  /** Stable code; defaults to `duplicate_resource`. */
  code?: ConflictCode;
  /** Optional resource type for clients (no instance ids required). */
  resource?: ConflictResource;
  /**
   * Actionable, non-sensitive context only (e.g. `{ field: 'url' }`).
   * Must not include wallet addresses, secrets, or raw DB constraint names
   * that embed sensitive values.
   */
  details?: Readonly<Record<string, unknown>>;
}

/**
 * Domain error representing an HTTP 409 Conflict.
 */
export class ConflictError extends Error {
  readonly statusCode = 409 as const;
  readonly code: ConflictCode;
  readonly resource?: ConflictResource;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: ConflictErrorOptions) {
    super(options.message);
    this.name = 'ConflictError';
    this.code = options.code ?? 'duplicate_resource';
    this.resource = options.resource;
    this.details = options.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Convenience: duplicate resource for a known type. */
export function duplicateResource(
  resource: ConflictResource,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ConflictError {
  return new ConflictError({
    message,
    code: 'duplicate_resource',
    resource,
    details,
  });
}
