import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import { sendProblem, validationFailed } from '../errors/index.js';

/**
 * Stable validation error envelope used by every request/response validator.
 * Never includes stack traces or internal exception text.
 */
export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationErrorBody {
  data: null;
  error: 'Validation failed';
  details: ValidationIssue[];
}

export function toValidationDetails(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

export function validationFailed(details: ValidationIssue[]): ValidationErrorBody {
  return {
    data: null,
    error: 'Validation failed',
    details,
  };
}

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json(validationFailed(toValidationDetails(error)));
}

/**
 * True when response bodies should be checked against Zod schemas.
 * Opt-in via env so production stays fail-open on response shape; enable in
 * CI / local contract tests with `ENABLE_RESPONSE_VALIDATION=true`.
 */
export function isResponseValidationEnabled(): boolean {
  const flag = process.env.ENABLE_RESPONSE_VALIDATION ?? process.env.RESPONSE_SCHEMA_VALIDATION;
  if (flag === 'true' || flag === '1') return true;
  // Default on under NODE_ENV=test when explicitly not disabled.
  if (process.env.NODE_ENV === 'test' && flag !== 'false' && flag !== '0') {
    // Soft default: only when RESPONSE_SCHEMA_SOFT is not forcing off.
    // We keep default OFF for NODE_ENV=test to avoid breaking legacy handlers
    // that still return non-envelope shapes; tests opt in per-suite.
    return false;
  }
  return false;
}

/**
 * Assert `value` matches `schema`. Throws a descriptive Error on mismatch so
 * integration tests fail loudly when the API drifts from its contract.
 */
export function assertMatchesSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label = 'response',
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = toValidationDetails(result.error)
      .map((d) => `${d.field}: ${d.message}`)
      .join('; ');
    throw new Error(`Schema validation failed for ${label}: ${details}`);
  }
  return result.data;
}

/**
 * Express middleware factory that validates `req.body` against a Zod schema.
 *
 * On success the parsed (and potentially transformed) body replaces `req.body`
 * so downstream handlers always receive well-typed data.
 *
 * On failure a `400` problem+json response is returned with field-level
 * `details` and stable code `validation_failed`.
 */
export function validateBody<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      sendProblem(res, validationFailed('Validation failed', details));
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Express middleware factory that validates `req.query` against a Zod schema.
 *
 * Parsed values replace `req.query` so handlers can consume validated and
 * coerced pagination/filter fields (e.g. numbers parsed from query strings).
 */
export function validateQuery<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      sendProblem(res, validationFailed('Validation failed', details));
      return;
    }

    req.query = result.data as Request['query'];
    next();
  };
}

/**
 * Express middleware factory that validates `req.params` against a Zod schema.
 */
export function validateParams<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      sendProblem(res, validationFailed('Validation failed', details));
      return;
    }

    req.params = result.data as Request['params'];
    next();
  };
}
