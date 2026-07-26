/**
 * Stable problem+json error taxonomy for the Creditra API.
 *
 * Clients should branch on `code` (and optionally `type`) rather than free-text
 * `detail` / `error` strings. Codes are stable once shipped; titles are fixed
 * per category and do not vary per occurrence.
 *
 * Aligns with conflict codes used by the conflict-409 work (duplicate_resource,
 * version_conflict, invalid_state_transition, unique_constraint_violation).
 */

import {
  HTTP_BAD_GATEWAY,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_GATEWAY_TIMEOUT,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
  HTTP_UNSUPPORTED_MEDIA_TYPE,
} from '../utils/httpStatus.js';

/** Base URI for problem `type` links (documentation anchor, not fetched). */
export const PROBLEM_TYPE_BASE = 'https://docs.creditra.dev/problems';

/**
 * Stable machine-readable error codes.
 * Extend carefully — existing values must not change meaning.
 */
export type ProblemCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'duplicate_resource'
  | 'version_conflict'
  | 'invalid_state_transition'
  | 'unique_constraint_violation'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'upstream_failure'
  | 'upstream_timeout'
  | 'service_unavailable'
  | 'internal_error';

/** HTTP status associated with each taxonomy code. */
export const PROBLEM_STATUS: Readonly<Record<ProblemCode, number>> = {
  validation_failed: HTTP_BAD_REQUEST,
  unauthorized: HTTP_UNAUTHORIZED,
  forbidden: HTTP_FORBIDDEN,
  not_found: HTTP_NOT_FOUND,
  duplicate_resource: HTTP_CONFLICT,
  version_conflict: HTTP_CONFLICT,
  invalid_state_transition: HTTP_CONFLICT,
  unique_constraint_violation: HTTP_CONFLICT,
  payload_too_large: HTTP_PAYLOAD_TOO_LARGE,
  unsupported_media_type: HTTP_UNSUPPORTED_MEDIA_TYPE,
  rate_limited: HTTP_TOO_MANY_REQUESTS,
  upstream_failure: HTTP_BAD_GATEWAY,
  upstream_timeout: HTTP_GATEWAY_TIMEOUT,
  service_unavailable: HTTP_SERVICE_UNAVAILABLE,
  internal_error: HTTP_INTERNAL_SERVER_ERROR,
};

/** Short, human-readable summary (same for a given code category). */
export const PROBLEM_TITLE: Readonly<Record<ProblemCode, string>> = {
  validation_failed: 'Validation Error',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not Found',
  duplicate_resource: 'Conflict',
  version_conflict: 'Conflict',
  invalid_state_transition: 'Conflict',
  unique_constraint_violation: 'Conflict',
  payload_too_large: 'Payload Too Large',
  unsupported_media_type: 'Unsupported Media Type',
  rate_limited: 'Too Many Requests',
  upstream_failure: 'Bad Gateway',
  upstream_timeout: 'Gateway Timeout',
  service_unavailable: 'Service Unavailable',
  internal_error: 'Internal Server Error',
};

/** Resource kinds that may appear on conflict / not-found problems. */
export type ProblemResource =
  | 'credit_line'
  | 'risk_evaluation'
  | 'webhook_subscription'
  | 'borrower'
  | 'event'
  | 'api_key'
  | 'transaction';

export function problemTypeUri(code: string): string {
  return `${PROBLEM_TYPE_BASE}/${code}`;
}

export function titleForCode(code: string): string {
  if (code in PROBLEM_TITLE) {
    return PROBLEM_TITLE[code as ProblemCode];
  }
  return 'Error';
}

export function statusForCode(code: string, fallback = 500): number {
  if (code in PROBLEM_STATUS) {
    return PROBLEM_STATUS[code as ProblemCode];
  }
  return fallback;
}
