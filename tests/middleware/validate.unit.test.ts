import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery } from '../../src/middleware/validate.js';

function createMockResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware unit', () => {
  it('validateBody passes parsed body and calls next', () => {
    const schema = z.object({ amount: z.coerce.number().positive() }).strict();
    const req: any = { body: { amount: '10' } };
    const res = createMockResponse();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(req.body).toEqual({ amount: 10 });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('validateBody returns 400 on invalid input', () => {
    const schema = z.object({ amount: z.number().positive() }).strict();
    const req: any = { body: { amount: -1, extra: true } };
    const res = createMockResponse();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation failed',
        details: expect.any(Array),
      }),
    );
  });

  it('validateQuery passes parsed query and calls next', () => {
    const schema = z.object({ page: z.coerce.number().int().positive().optional() }).strict();
    const req: any = { query: { page: '2' } };
    const res = createMockResponse();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(req.query).toEqual({ page: 2 });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('validateQuery returns 400 on invalid query', () => {
    const schema = z.object({ limit: z.coerce.number().int().positive().max(100).optional() }).strict();
    const req: any = { query: { limit: '101', extra: 'x' } };
    const res = createMockResponse();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation failed',
        details: expect.any(Array),
      }),
    );
  });
});
