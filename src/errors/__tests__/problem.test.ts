import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import {
  AppError,
  ConflictError,
  PROBLEM_TYPE_BASE,
  appErrorToProblem,
  conflictToProblem,
  duplicateResource,
  forbidden,
  internalError,
  notFound,
  rateLimited,
  sendProblem,
  toProblem,
  translateUnknownError,
  unauthorized,
  upstreamFailure,
  upstreamTimeout,
  validationFailed,
} from '../index.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function mockRes(): MockRes {
  const state = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
  };
  const res: MockRes = {
    get statusCode() {
      return state.statusCode;
    },
    get headers() {
      return state.headers;
    },
    get body() {
      return state.body;
    },
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.setHeader.mockImplementation((k: string, v: string) => {
    state.headers[k.toLowerCase()] = v;
    return res;
  });
  res.status.mockImplementation((code: number) => {
    state.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    state.body = body;
    return res;
  });
  return res;
}

describe('taxonomy problem+json', () => {
  it('validation_failed includes field details and stable type', () => {
    const err = validationFailed('Validation failed', [
      { field: 'amount', message: 'Must be positive' },
    ]);
    const problem = appErrorToProblem(err);
    expect(problem.status).toBe(400);
    expect(problem.code).toBe('validation_failed');
    expect(problem.type).toBe(`${PROBLEM_TYPE_BASE}/validation_failed`);
    expect(problem.title).toBe('Validation Error');
    expect(problem.detail).toBe('Validation failed');
    expect(problem.error).toBe(problem.detail);
    expect(problem.data).toBeNull();
    expect(problem.details).toEqual([
      { field: 'amount', message: 'Must be positive' },
    ]);
  });

  it('auth codes map to 401 / 403', () => {
    expect(appErrorToProblem(unauthorized()).status).toBe(401);
    expect(appErrorToProblem(unauthorized()).code).toBe('unauthorized');
    expect(appErrorToProblem(forbidden()).status).toBe(403);
    expect(appErrorToProblem(forbidden()).code).toBe('forbidden');
  });

  it('not_found may include resource', () => {
    const problem = appErrorToProblem(notFound('missing', 'credit_line'));
    expect(problem.status).toBe(404);
    expect(problem.code).toBe('not_found');
    expect(problem.resource).toBe('credit_line');
  });

  it('conflict codes use title Conflict and 409', () => {
    const err = duplicateResource('webhook_subscription', 'already registered', {
      field: 'url',
    });
    const problem = conflictToProblem(err);
    expect(problem.status).toBe(409);
    expect(problem.title).toBe('Conflict');
    expect(problem.type).toBe(`${PROBLEM_TYPE_BASE}/duplicate_resource`);
    expect(problem.resource).toBe('webhook_subscription');
    expect(problem.details).toEqual({ field: 'url' });
  });

  it('rate_limited includes retryAfter', () => {
    const problem = appErrorToProblem(rateLimited(42));
    expect(problem.status).toBe(429);
    expect(problem.code).toBe('rate_limited');
    expect(problem.retryAfter).toBe(42);
    expect(problem.detail).toContain('Too many requests');
  });

  it('upstream failures use 502 / 504 with stable messages', () => {
    expect(appErrorToProblem(upstreamFailure()).status).toBe(502);
    expect(appErrorToProblem(upstreamTimeout()).status).toBe(504);
    expect(appErrorToProblem(upstreamFailure()).code).toBe('upstream_failure');
  });

  it('internal_error never exposes constructor message when exposeMessage is false', () => {
    const err = internalError('SELECT * FROM secrets');
    const problem = appErrorToProblem(err);
    expect(problem.status).toBe(500);
    expect(problem.detail).toBe('Internal server error');
    expect(problem.error).toBe('Internal server error');
    expect(problem.detail).not.toContain('SELECT');
  });

  it('sendProblem sets Content-Type and Retry-After', () => {
    const res = mockRes();
    sendProblem(res as unknown as Response, rateLimited(7));
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['retry-after']).toBe('7');
    expect(res.statusCode).toBe(429);
    expect((res.body as { code: string }).code).toBe('rate_limited');
  });
});

describe('translateUnknownError', () => {
  it('maps named ValidationError / NotFoundError', () => {
    const v = new Error('bad');
    v.name = 'ValidationError';
    expect(translateUnknownError(v)?.code).toBe('validation_failed');

    const n = new Error('gone');
    n.name = 'NotFoundError';
    expect(translateUnknownError(n)?.code).toBe('not_found');
  });

  it('maps VersionConflictError and InvalidTransitionError to ConflictError codes', () => {
    const v = new Error('stale');
    v.name = 'VersionConflictError';
    expect(translateUnknownError(v)?.code).toBe('version_conflict');

    const t = new Error('closed');
    t.name = 'InvalidTransitionError';
    expect(translateUnknownError(t)?.code).toBe('invalid_state_transition');
  });

  it('maps body-parser entity.too.large to payload_too_large', () => {
    const err = { type: 'entity.too.large', status: 413, message: 'too big' };
    const translated = translateUnknownError(err);
    expect(translated?.code).toBe('payload_too_large');
    expect(translated?.statusCode).toBe(413);
  });

  it('maps HttpTimeoutError / HttpRequestError to upstream codes without leaking URL', () => {
    const timeout = new Error('HTTP read timeout after 1000ms: https://secret.example/x');
    timeout.name = 'HttpTimeoutError';
    const t = translateUnknownError(timeout)!;
    expect(t.code).toBe('upstream_timeout');
    expect(appErrorToProblem(t).detail).not.toContain('secret.example');

    const reqErr = new Error('fail https://secret.example');
    reqErr.name = 'HttpRequestError';
    const u = translateUnknownError(reqErr)!;
    expect(u.code).toBe('upstream_failure');
    expect(appErrorToProblem(u).detail).not.toContain('secret.example');
  });

  it('returns null for unknown shapes (caller uses internal_error)', () => {
    expect(translateUnknownError({ foo: 1 })).toBeNull();
  });

  it('passes through AppError and ConflictError', () => {
    const app = validationFailed();
    expect(translateUnknownError(app)).toBe(app);
    const conflict = new ConflictError({ message: 'dup' });
    expect(translateUnknownError(conflict)).toBe(conflict);
  });
});

describe('toProblem expose rules', () => {
  it('hides messages for status >= 500 unless exposeMessage true', () => {
    const hidden = toProblem({
      statusCode: 500,
      code: 'internal_error',
      message: 'db password xyz',
      exposeMessage: false,
    });
    expect(hidden.detail).toBe('Internal server error');

    const shown = toProblem({
      statusCode: 502,
      code: 'upstream_failure',
      message: 'Upstream service failed',
      exposeMessage: true,
    });
    expect(shown.detail).toBe('Upstream service failed');
  });
});
