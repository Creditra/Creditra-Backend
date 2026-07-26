import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../middleware/errorHandler.js';
import { AppError, validationFailed } from '../../errors/index.js';

const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('errorHandler middleware (problem+json)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response> & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    headersSent?: boolean;
  };
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      headersSent: false,
    };
    mockNext = vi.fn();
    mockConsoleError.mockClear();
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  function body(): Record<string, unknown> {
    return mockResponse.json.mock.calls[0][0] as Record<string, unknown>;
  }

  it('should log error details', () => {
    const error = new Error('Test error');
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockConsoleError).toHaveBeenCalledWith('[errorHandler]', {
      message: 'Test error',
      stack: expect.any(String),
      name: 'Error',
    });
  });

  it('should handle generic errors with 500 problem+json and no stack leak', () => {
    const error = new Error('Database connection failed');
    error.stack = 'Detailed stack trace';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringContaining('application/problem+json'),
    );
    expect(body()).toMatchObject({
      code: 'internal_error',
      status: 500,
      detail: 'Internal server error',
      error: 'Internal server error',
      data: null,
    });
    expect(JSON.stringify(body())).not.toContain('Detailed stack');
    expect(JSON.stringify(body())).not.toContain('Database connection');
  });

  it('should handle ValidationError with 400 problem+json', () => {
    const error = new Error('Validation failed');
    error.name = 'ValidationError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(body()).toMatchObject({
      code: 'validation_failed',
      status: 400,
      detail: 'Validation failed',
      error: 'Validation failed',
    });
  });

  it('should handle NotFoundError with 404', () => {
    const error = new Error('Resource not found');
    error.name = 'NotFoundError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(body()).toMatchObject({
      code: 'not_found',
      detail: 'Resource not found',
    });
  });

  it('should handle UnauthorizedError with 401', () => {
    const error = new Error('Unauthorized access');
    error.name = 'UnauthorizedError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(body()).toMatchObject({ code: 'unauthorized' });
  });

  it('should handle ForbiddenError with 403', () => {
    const error = new Error('Access forbidden');
    error.name = 'ForbiddenError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(body()).toMatchObject({ code: 'forbidden' });
  });

  it('should handle typed AppError directly', () => {
    errorHandler(
      validationFailed('Validation failed', [{ field: 'x', message: 'bad' }]),
      mockRequest as Request,
      mockResponse as Response,
      mockNext,
    );

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(body()).toMatchObject({
      code: 'validation_failed',
      details: [{ field: 'x', message: 'bad' }],
    });
  });

  it('should map entity.too.large to payload_too_large', () => {
    errorHandler(
      { type: 'entity.too.large', status: 413 },
      mockRequest as Request,
      mockResponse as Response,
      mockNext,
    );

    expect(mockResponse.status).toHaveBeenCalledWith(413);
    expect(body()).toMatchObject({ code: 'payload_too_large' });
  });

  it('should allow explicit string errors to surface (historical)', () => {
    errorHandler(
      'Database connection failed',
      mockRequest as Request,
      mockResponse as Response,
      mockNext,
    );

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(body()).toMatchObject({
      code: 'internal_error',
      error: 'Database connection failed',
    });
  });

  it('should handle unknown error types as internal_error', () => {
    errorHandler(
      { someProperty: 'some value' } as unknown,
      mockRequest as Request,
      mockResponse as Response,
      mockNext,
    );

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(body()).toMatchObject({
      code: 'internal_error',
      detail: 'Internal server error',
    });
  });

  it('should map VersionConflictError to conflict problem', () => {
    const error = new Error('stale version');
    error.name = 'VersionConflictError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(body()).toMatchObject({
      code: 'version_conflict',
      title: 'Conflict',
    });
  });

  it('should map HttpTimeoutError to upstream_timeout without leaking message URL', () => {
    const error = new Error('HTTP read timeout: https://internal.secret/path');
    error.name = 'HttpTimeoutError';

    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(504);
    expect(body()).toMatchObject({ code: 'upstream_timeout' });
    expect(JSON.stringify(body())).not.toContain('internal.secret');
  });
});
