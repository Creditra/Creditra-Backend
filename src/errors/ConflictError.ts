/**
 * Shared conflict error for duplicate resources and state conflicts.
 *
 * Thrown by services/repositories when a write would violate uniqueness or
 * an invalid concurrent state (duplicate open, version mismatch, etc.).
 * Mapped by {@link sendConflict} / the global error handler to HTTP 409 with
 * RFC 7807 problem+json details.
 *
 * Compatible with the conflict-409 taxonomy codes so open PR work can merge
 * cleanly. Security: never put wallet addresses, secrets, API keys, or other
 * sensitive identifiers into `message` or `details`.
 */

import { AppError, type AppErrorOptions } from './AppError.js';
import type { ProblemCode, ProblemResource } from './taxonomy.js';

/** Stable machine-readable conflict codes clients can branch on. */
export type ConflictCode =
  | 'duplicate_resource'
  | 'version_conflict'
  | 'invalid_state_transition'
  | 'unique_constraint_violation';

/** Resource kinds involved in conflict responses (public taxonomy). */
export type ConflictResource = ProblemResource;

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
 * Extends {@link AppError} so the central translator handles it uniformly.
 */
export class ConflictError extends AppError {
  declare readonly code: ConflictCode;
  declare readonly statusCode: 409;

  constructor(options: ConflictErrorOptions) {
    const code: ConflictCode = options.code ?? 'duplicate_resource';
    const base: AppErrorOptions = {
      code: code as ProblemCode,
      message: options.message,
      statusCode: 409,
      title: 'Conflict',
      details: options.details,
      resource: options.resource,
      exposeMessage: true,
    };
    super(base);
    this.name = 'ConflictError';
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

export function isConflictError(err: unknown): err is ConflictError {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { name?: string }).name === 'ConflictError' ||
      err instanceof ConflictError) &&
    (err as { statusCode?: number }).statusCode === 409 &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}
