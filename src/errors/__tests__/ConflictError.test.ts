import { describe, it, expect } from 'vitest';
import {
  ConflictError,
  duplicateResource,
  conflictFromUniqueViolation,
  isUniqueViolation,
  conflictToProblem,
  PROBLEM_TYPE_BASE,
  PG_UNIQUE_VIOLATION,
} from '../index.js';

describe('ConflictError', () => {
  it('defaults code to duplicate_resource', () => {
    const err = new ConflictError({ message: 'dup' });
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('duplicate_resource');
    expect(err.name).toBe('ConflictError');
    expect(err.message).toBe('dup');
  });

  it('duplicateResource factory sets resource', () => {
    const err = duplicateResource('credit_line', 'already open', { field: 'walletAddress' });
    expect(err.code).toBe('duplicate_resource');
    expect(err.resource).toBe('credit_line');
    expect(err.details).toEqual({ field: 'walletAddress' });
  });
});

describe('uniqueViolation mapper', () => {
  it('detects Postgres 23505', () => {
    expect(isUniqueViolation({ code: PG_UNIQUE_VIOLATION })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
  });

  it('maps known constraints to safe messages without leaking detail values', () => {
    const err = {
      code: PG_UNIQUE_VIOLATION,
      constraint: 'borrowers_wallet_address_key',
      detail: 'Key (wallet_address)=(GSECRETWALLET) already exists.',
    };
    const conflict = conflictFromUniqueViolation(err);
    expect(conflict).toBeInstanceOf(ConflictError);
    expect(conflict!.code).toBe('unique_constraint_violation');
    expect(conflict!.resource).toBe('borrower');
    expect(conflict!.message).not.toContain('GSECRETWALLET');
    expect(JSON.stringify(conflict!.details)).not.toContain('GSECRETWALLET');
  });

  it('maps credit_lines unique index to credit_line resource', () => {
    const conflict = conflictFromUniqueViolation({
      code: '23505',
      constraint: 'credit_lines_one_open_per_borrower',
    });
    expect(conflict!.resource).toBe('credit_line');
    expect(conflict!.message.toLowerCase()).toContain('credit line');
  });

  it('returns null for non-unique errors', () => {
    expect(conflictFromUniqueViolation(new Error('other'))).toBeNull();
  });
});

describe('conflictToProblem', () => {
  it('builds RFC7807 problem+json with stable type and legacy error field', () => {
    const err = duplicateResource('webhook_subscription', 'already registered', {
      field: 'url',
    });
    const problem = conflictToProblem(err);
    expect(problem.status).toBe(409);
    expect(problem.title).toBe('Conflict');
    expect(problem.type).toBe(`${PROBLEM_TYPE_BASE}/duplicate_resource`);
    expect(problem.code).toBe('duplicate_resource');
    expect(problem.resource).toBe('webhook_subscription');
    expect(problem.detail).toBe('already registered');
    expect(problem.error).toBe(problem.detail);
    expect(problem.data).toBeNull();
    expect(problem.details).toEqual({ field: 'url' });
  });
});
