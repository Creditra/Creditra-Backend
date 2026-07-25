/**
 * RFC 7807 problem+json helpers for conflict (and related) responses.
 *
 * Conflict responses use `Content-Type: application/problem+json` with a
 * stable `code` extension so clients can branch without parsing free text.
 * A legacy `error` string (equal to `detail`) is included so older clients
 * that only read the envelope still work.
 */
import type { Response } from 'express';
import type { ConflictError } from './ConflictError.js';
import { HTTP_CONFLICT } from '../utils/httpStatus.js';

/** Base URI for problem `type` links (documentation anchor, not fetched). */
export const PROBLEM_TYPE_BASE = 'https://docs.creditra.dev/problems';

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
  details?: Readonly<Record<string, unknown>>;
  /** Legacy envelope compatibility. */
  data: null;
  /** Legacy envelope compatibility — same text as `detail`. */
  error: string;
}

/**
 * Build a problem+json body from a {@link ConflictError}.
 * Never copies sensitive fields — only what ConflictError already sanitised.
 */
export function conflictToProblem(err: ConflictError): ProblemDetails {
  const code = err.code;
  return {
    type: `${PROBLEM_TYPE_BASE}/${code}`,
    title: 'Conflict',
    status: HTTP_CONFLICT,
    detail: err.message,
    code,
    ...(err.resource !== undefined ? { resource: err.resource } : {}),
    ...(err.details !== undefined ? { details: err.details } : {}),
    data: null,
    error: err.message,
  };
}

/**
 * Send a 409 Conflict response as `application/problem+json`.
 */
export function sendConflict(res: Response, err: ConflictError): Response {
  const body = conflictToProblem(err);
  res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
  return res.status(HTTP_CONFLICT).json(body);
}

/**
 * Type guard for ConflictError (duck-typed to avoid circular import issues
 * when tests construct plain objects).
 */
export function isConflictError(err: unknown): err is ConflictError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConflictError' &&
    (err as { statusCode?: number }).statusCode === 409 &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}
