/**
 * RFC 7807 problem+json helpers.
 *
 * All taxonomy categories (validation, auth, not found, conflict, rate limit,
 * upstream, internal) share this shape. Content-Type is
 * `application/problem+json`. Legacy `error` / `data` fields remain so older
 * clients that only read the envelope still work.
 */

import type { Response } from 'express';
import type { AppError, ProblemDetailsExt } from './AppError.js';
import { AppError as AppErrorClass, isAppError } from './AppError.js';
import {
  ConflictError,
  isConflictError,
  type ConflictError as ConflictErrorType,
} from './ConflictError.js';
import {
  PROBLEM_TYPE_BASE,
  problemTypeUri,
  titleForCode,
} from './taxonomy.js';

export { PROBLEM_TYPE_BASE };

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

export interface ProblemDetails {
  /** URI reference identifying the problem type. */
  type: string;
  /** Short, human-readable summary (same for a given type). */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail: string;
  /** Stable machine code (extension member). */
  code: string;
  /** Optional resource kind (extension). */
  resource?: string;
  /** Optional safe, actionable context (extension). */
  details?: ProblemDetailsExt;
  /** Seconds until the client may retry (rate limit). */
  retryAfter?: number;
  /** Legacy envelope compatibility. */
  data: null;
  /** Legacy envelope compatibility — same text as `detail`. */
  error: string;
}

export interface ProblemSource {
  statusCode: number;
  code: string;
  message: string;
  title?: string;
  details?: ProblemDetailsExt;
  resource?: string;
  retryAfter?: number;
  /** When false, detail is replaced with a generic server message. */
  exposeMessage?: boolean;
}

/**
 * Build a problem+json body from a typed source.
 * Never copies stack traces or unknown Error fields.
 */
export function toProblem(source: ProblemSource): ProblemDetails {
  const status = source.statusCode;
  const expose =
    source.exposeMessage ?? (status < 500 || isSafeUpstreamStatus(status));
  const detail = expose
    ? source.message
    : 'Internal server error';

  const body: ProblemDetails = {
    type: problemTypeUri(source.code),
    title: source.title ?? titleForCode(source.code),
    status,
    detail,
    code: source.code,
    data: null,
    error: detail,
  };

  if (source.resource !== undefined) {
    body.resource = source.resource;
  }
  if (source.details !== undefined) {
    body.details = source.details;
  }
  if (source.retryAfter !== undefined) {
    body.retryAfter = source.retryAfter;
  }

  return body;
}

function isSafeUpstreamStatus(status: number): boolean {
  // 502/503/504 may expose a stable generic phrase already set on AppError.
  return status === 502 || status === 503 || status === 504;
}

/**
 * Build a problem+json body from an {@link AppError} (or ConflictError).
 */
export function appErrorToProblem(err: AppError): ProblemDetails {
  return toProblem({
    statusCode: err.statusCode,
    code: err.code,
    message: err.message,
    title: err.title,
    details: err.details,
    resource: err.resource,
    retryAfter: err.retryAfter,
    exposeMessage: err.exposeMessage,
  });
}

/**
 * Build a problem+json body from a {@link ConflictError}.
 * Kept for API parity with conflict-focused PRs.
 */
export function conflictToProblem(err: ConflictErrorType): ProblemDetails {
  return appErrorToProblem(err);
}

/**
 * Set a response header using whichever Express API the mock/real res exposes.
 */
function setResponseHeader(res: Response, name: string, value: string): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
    return;
  }
  const withSet = res as Response & {
    set?: (field: string | Record<string, string>, value?: string) => Response;
  };
  if (typeof withSet.set === 'function') {
    withSet.set(name, value);
  }
}

/**
 * Send any problem source as `application/problem+json`.
 */
export function sendProblem(res: Response, source: ProblemSource | AppError): Response {
  const problem =
    source instanceof AppErrorClass || isAppError(source)
      ? appErrorToProblem(source)
      : toProblem(source);

  if (problem.retryAfter !== undefined) {
    setResponseHeader(res, 'Retry-After', String(problem.retryAfter));
  }

  setResponseHeader(res, 'Content-Type', PROBLEM_CONTENT_TYPE);
  return res.status(problem.status).json(problem);
}

/**
 * Send a 409 Conflict response as `application/problem+json`.
 */
export function sendConflict(res: Response, err: ConflictErrorType): Response {
  return sendProblem(res, err);
}

/**
 * Map well-known Error.name / status shapes into AppError for the translator.
 * Returns null when the error is unknown (caller should emit internal_error).
 */
export function translateUnknownError(err: unknown): AppError | null {
  if (err instanceof AppErrorClass || isAppError(err)) {
    return err instanceof AppErrorClass
      ? err
      : new AppErrorClass({
          code: (err as AppError).code,
          message: (err as AppError).message,
          statusCode: (err as AppError).statusCode,
          title: (err as AppError).title,
          details: (err as AppError).details,
          resource: (err as AppError).resource,
          retryAfter: (err as AppError).retryAfter,
          exposeMessage: (err as AppError).exposeMessage,
        });
  }

  if (err instanceof ConflictError || isConflictError(err)) {
    return err instanceof ConflictError
      ? err
      : new ConflictError({
          message: (err as ConflictErrorType).message,
          code: (err as ConflictErrorType).code,
          resource: (err as ConflictErrorType).resource,
          details: (err as ConflictErrorType).details as
            | Readonly<Record<string, unknown>>
            | undefined,
        });
  }

  const maybe = err as {
    status?: number;
    statusCode?: number;
    type?: string;
    name?: string;
    message?: string;
    code?: string;
  };

  // Body-parser payload limit
  if (maybe?.type === 'entity.too.large' || maybe?.status === 413) {
    return new AppErrorClass({
      code: 'payload_too_large',
      message: 'Request body too large. Maximum size is 100kb.',
      exposeMessage: true,
    });
  }

  if (!(err instanceof Error) && typeof err !== 'object') {
    return null;
  }

  const name = err instanceof Error ? err.name : maybe?.name;
  const message =
    err instanceof Error
      ? err.message
      : typeof maybe?.message === 'string'
        ? maybe.message
        : 'Request failed';

  switch (name) {
    case 'ValidationError':
      return new AppErrorClass({
        code: 'validation_failed',
        message,
        exposeMessage: true,
      });
    case 'UnauthorizedError':
      return new AppErrorClass({
        code: 'unauthorized',
        message,
        exposeMessage: true,
      });
    case 'ForbiddenError':
      return new AppErrorClass({
        code: 'forbidden',
        message,
        exposeMessage: true,
      });
    case 'NotFoundError':
    case 'CreditLineNotFoundError':
      return new AppErrorClass({
        code: 'not_found',
        message,
        resource: name === 'CreditLineNotFoundError' ? 'credit_line' : undefined,
        exposeMessage: true,
      });
    case 'ConflictError':
      return new ConflictError({ message, code: 'duplicate_resource' });
    case 'VersionConflictError':
      return new ConflictError({ message, code: 'version_conflict' });
    case 'InvalidTransitionError':
      return new ConflictError({ message, code: 'invalid_state_transition' });
    case 'HttpTimeoutError':
      return new AppErrorClass({
        code: 'upstream_timeout',
        message: 'Upstream service timed out',
        exposeMessage: true,
      });
    case 'HttpRequestError':
      return new AppErrorClass({
        code: 'upstream_failure',
        message: 'Upstream service failed',
        exposeMessage: true,
      });
    default:
      break;
  }

  const status = maybe?.statusCode ?? maybe?.status;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    const code =
      status === 400
        ? 'validation_failed'
        : status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : status === 404
              ? 'not_found'
              : status === 409
                ? 'duplicate_resource'
                : status === 413
                  ? 'payload_too_large'
                  : status === 415
                    ? 'unsupported_media_type'
                    : status === 429
                      ? 'rate_limited'
                      : status === 502
                        ? 'upstream_failure'
                        : status === 503
                          ? 'service_unavailable'
                          : status === 504
                            ? 'upstream_timeout'
                            : 'internal_error';
    return new AppErrorClass({
      code,
      message: status >= 500 ? 'Internal server error' : message,
      statusCode: status,
      exposeMessage: status < 500,
    });
  }

  return null;
}
