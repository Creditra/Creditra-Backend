/**
 * Typed application errors for RFC 7807 problem+json responses.
 *
 * Throw (or `next(err)`) these from routes/services/middleware so the global
 * error translator can emit a stable `type` + `code` without leaking internals.
 *
 * Security: never put wallet addresses, secrets, API keys, stack traces, or
 * raw upstream payloads into `message` or `details` when they may reach clients.
 * For 5xx codes the translator may replace `message` with a generic detail.
 */

import {
  PROBLEM_STATUS,
  PROBLEM_TITLE,
  type ProblemCode,
  type ProblemResource,
} from './taxonomy.js';

export type FieldIssue = Readonly<{ field: string; message: string }>;

export type ProblemDetailsExt =
  | Readonly<Record<string, unknown>>
  | ReadonlyArray<FieldIssue>;

export interface AppErrorOptions {
  /** Stable machine code from the public taxonomy. */
  code: ProblemCode;
  /** Human-readable, non-sensitive explanation (problem `detail`). */
  message: string;
  /** Override HTTP status; defaults from {@link PROBLEM_STATUS}. */
  statusCode?: number;
  /** Override short title; defaults from {@link PROBLEM_TITLE}. */
  title?: string;
  /**
   * Actionable, non-sensitive context (field issues for validation, or a
   * small object). Must not include secrets or end-user identifiers.
   */
  details?: ProblemDetailsExt;
  /** Optional resource kind (extension member). */
  resource?: ProblemResource;
  /** Seconds until retry is allowed (rate limit / maintenance). */
  retryAfter?: number;
  /**
   * When false, clients always get a generic detail for this status band
   * (used for unexpected 5xx). Defaults to true for 4xx and known upstream
   * codes, false for internal_error.
   */
  exposeMessage?: boolean;
}

/**
 * Domain / HTTP error with stable taxonomy metadata.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ProblemCode;
  readonly title: string;
  readonly details?: ProblemDetailsExt;
  readonly resource?: ProblemResource;
  readonly retryAfter?: number;
  readonly exposeMessage: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? PROBLEM_STATUS[options.code];
    this.title = options.title ?? PROBLEM_TITLE[options.code];
    this.details = options.details;
    this.resource = options.resource;
    this.retryAfter = options.retryAfter;
    this.exposeMessage =
      options.exposeMessage ??
      (options.code !== 'internal_error' && this.statusCode < 500);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Validation failure (HTTP 400) with optional field-level issues. */
export function validationFailed(
  message = 'Validation failed',
  details?: ReadonlyArray<FieldIssue>,
): AppError {
  return new AppError({
    code: 'validation_failed',
    message,
    details,
    exposeMessage: true,
  });
}

/** Missing credentials (HTTP 401). */
export function unauthorized(message = 'Unauthorized'): AppError {
  return new AppError({ code: 'unauthorized', message, exposeMessage: true });
}

/** Invalid credentials (HTTP 403). */
export function forbidden(message = 'Forbidden'): AppError {
  return new AppError({ code: 'forbidden', message, exposeMessage: true });
}

/** Resource missing (HTTP 404). */
export function notFound(
  message = 'Resource not found',
  resource?: ProblemResource,
  details?: Readonly<Record<string, unknown>>,
): AppError {
  return new AppError({
    code: 'not_found',
    message,
    resource,
    details,
    exposeMessage: true,
  });
}

/** Rate limit exhausted (HTTP 429). */
export function rateLimited(
  retryAfterSeconds: number,
  message?: string,
): AppError {
  const detail =
    message ??
    `Too many requests. Please retry after ${retryAfterSeconds} seconds.`;
  return new AppError({
    code: 'rate_limited',
    message: detail,
    retryAfter: retryAfterSeconds,
    exposeMessage: true,
  });
}

/** Upstream dependency failed (HTTP 502). */
export function upstreamFailure(
  message = 'Upstream service failed',
): AppError {
  return new AppError({
    code: 'upstream_failure',
    message,
    // Safe generic client text; real cause stays in logs only.
    exposeMessage: true,
  });
}

/** Upstream timed out (HTTP 504). */
export function upstreamTimeout(
  message = 'Upstream service timed out',
): AppError {
  return new AppError({
    code: 'upstream_timeout',
    message,
    exposeMessage: true,
  });
}

/** Service unavailable / misconfigured (HTTP 503). */
export function serviceUnavailable(
  message = 'Service temporarily unavailable',
  details?: Readonly<Record<string, unknown>>,
): AppError {
  return new AppError({
    code: 'service_unavailable',
    message,
    details,
    exposeMessage: true,
  });
}

/** Payload exceeds configured limit (HTTP 413). */
export function payloadTooLarge(
  message = 'Request body too large. Maximum size is 100kb.',
): AppError {
  return new AppError({
    code: 'payload_too_large',
    message,
    exposeMessage: true,
  });
}

/** Wrong Content-Type on mutating request (HTTP 415). */
export function unsupportedMediaType(
  message = 'Content-Type must be application/json',
): AppError {
  return new AppError({
    code: 'unsupported_media_type',
    message,
    exposeMessage: true,
  });
}

/** Unexpected internal failure (HTTP 500) — message never sent to clients. */
export function internalError(
  message = 'Internal server error',
): AppError {
  return new AppError({
    code: 'internal_error',
    message,
    exposeMessage: false,
  });
}

/**
 * Guard for AppError (and subclasses such as ConflictError).
 * Prefer `instanceof` when available; duck-type for plain objects.
 */
export function isAppError(err: unknown): err is AppError {
  if (err instanceof AppError) {
    return true;
  }
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string' &&
    ((err as { name?: string }).name === 'AppError' ||
      (err as { name?: string }).name === 'ConflictError')
  );
}
