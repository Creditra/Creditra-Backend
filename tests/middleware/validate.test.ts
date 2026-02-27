import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateBody } from '../../src/middleware/validate.js';

/**
 * Builds a tiny Express app that applies `validateBody(schema)` to POST /
 * then echoes back the parsed body.
 */
function buildApp(schema: z.ZodSchema) {
  const app = express();
  app.use(express.json());
  app.post('/', validateBody(schema), (req, res) => {
    res.json({ ok: true, body: req.body });
  });
  return app;
}

const testSchema = z.object({
  name: z.string({ required_error: 'name is required' }).min(1, 'name must not be empty'),
  age: z.number({ required_error: 'age is required' }).int().positive('age must be positive'),
});

describe('validateBody middleware', () => {
  it('passes valid data through and replaces req.body with parsed value', async () => {
    const res = await request(buildApp(testSchema))
      .post('/')
      .send({ name: 'Alice', age: 30 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, body: { name: 'Alice', age: 30 } });
  });

  it('strips unknown keys (strict by default from schema)', async () => {
    const strictSchema = z.object({ x: z.number() }).strict();
    const res = await request(buildApp(strictSchema))
      .post('/')
      .send({ x: 1, extra: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with field-level details when body is empty', async () => {
    const res = await request(buildApp(testSchema))
      .post('/')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThanOrEqual(1);
    // Each detail should have field + message
    for (const d of res.body.details) {
      expect(d).toHaveProperty('field');
      expect(d).toHaveProperty('message');
    }
  });

  it('returns 400 when a required field is missing', async () => {
    const res = await request(buildApp(testSchema))
      .post('/')
      .send({ name: 'Alice' }); // missing age

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: any) => d.field === 'age')).toBe(true);
  });

  it('returns 400 when a field has wrong type', async () => {
    const res = await request(buildApp(testSchema))
      .post('/')
      .send({ name: 'Alice', age: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.details.some((d: any) => d.field === 'age')).toBe(true);
  });

  it('returns 400 with constraint message on invalid value', async () => {
    const res = await request(buildApp(testSchema))
      .post('/')
      .send({ name: '', age: -5 });

    expect(res.status).toBe(400);
    const fields = res.body.details.map((d: any) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('age');
  });

  it('handles nested path in error details', async () => {
    const nested = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    });

    const res = await request(buildApp(nested))
      .post('/')
      .send({ user: { email: 'bad' } });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('user.email');
  });

  it('returns 400 when body is null/undefined (no JSON)', async () => {
    const res = await request(buildApp(testSchema))
      .post('/')
      .set('Content-Type', 'application/json')
      .send('');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
