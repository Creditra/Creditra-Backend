/**
 * Standardised error categories for the Creditra API.
 *
 * Every AppError carries one of these codes; the error-handling middleware
 * maps each code to the correct HTTP status.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Map error codes → HTTP status codes */
const STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.AUTHENTICATION_ERROR]: 401,
  [ErrorCode.AUTHORIZATION_ERROR]: 403,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

/**
 * Application-level error class.
 *
 * Throw or pass an `AppError` anywhere in a request lifecycle and the
 * global error-handling middleware will serialise it into a consistent
 * JSON envelope automatically.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_MAP[code];
    this.details = details;
    this.isOperational = isOperational;

    // Maintain proper prototype chain for `instanceof` checks
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/* ------------------------------------------------------------------ */
/*  Factory helpers – keep call-sites terse and readable               */
/* ------------------------------------------------------------------ */

export const validationError = (message: string, details?: unknown) =>
  new AppError(message, ErrorCode.VALIDATION_ERROR, details);

export const notFoundError = (resource: string, id?: string) =>
  new AppError(
    id ? `${resource} with id "${id}" not found` : `${resource} not found`,
    ErrorCode.NOT_FOUND,
    id ? { resource, id } : { resource },
  );

export const authenticationError = (message = 'Authentication required') =>
  new AppError(message, ErrorCode.AUTHENTICATION_ERROR);

export const authorizationError = (message = 'Forbidden') =>
  new AppError(message, ErrorCode.AUTHORIZATION_ERROR);

export const internalError = (message = 'Internal server error', details?: unknown) =>
  new AppError(message, ErrorCode.INTERNAL_ERROR, details, false);
