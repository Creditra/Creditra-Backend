import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  validateBody,
  validateResponse,
  assertMatchesSchema,
  isResponseValidationEnabled,
  toValidationDetails,
} from '../../src/middleware/validate.js';
import {
  apiEnvelopeSchema,
  envelopedRiskResultSchema,
  errorEnvelopeSchema,
} from '../../src/schemas/index.js';

describe('response schema validation', () => {
  const prev = process.env.ENABLE_RESPONSE_VALIDATION;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.ENABLE_RESPONSE_VALIDATION;
    } else {
      process.env.ENABLE_RESPONSE_VALIDATION = prev;
    }
  });

  describe('isResponseValidationEnabled', () => {
    it('is false by default', () => {
      delete process.env.ENABLE_RESPONSE_VALIDATION;
      delete process.env.RESPONSE_SCHEMA_VALIDATION;
      expect(isResponseValidationEnabled()).toBe(false);
    });

    it('is true when ENABLE_RESPONSE_VALIDATION=true', () => {
      process.env.ENABLE_RESPONSE_VALIDATION = 'true';
      expect(isResponseValidationEnabled()).toBe(true);
    });
  });

  describe('validateResponse middleware', () => {
    const payloadSchema = apiEnvelopeSchema(
      z.object({ id: z.string(), amount: z.string() }).strict(),
    );

    function buildApp(enable: boolean) {
      process.env.ENABLE_RESPONSE_VALIDATION = enable ? 'true' : 'false';
      const app = express();
      app.use(express.json());
      app.get('/ok', validateResponse(payloadSchema), (_req, res) => {
        res.json({ data: { id: '1', amount: '10' }, error: null });
      });
      app.get('/bad', validateResponse(payloadSchema), (_req, res) => {
        res.json({ data: { id: 1 }, error: null });
      });
      return app;
    }

    it('passes matching responses through when enabled', async () => {
      const res = await request(buildApp(true)).get('/ok');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { id: '1', amount: '10' }, error: null });
    });

    it('returns stable 500 envelope on contract violation (no Zod internals)', async () => {
      const res = await request(buildApp(true)).get('/bad');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ data: null, error: 'Response contract violation' });
      expect(JSON.stringify(res.body)).not.toMatch(/ZodError|stack|node_modules/i);
    });

    it('is a no-op when disabled (mismatched body still returned)', async () => {
      const res = await request(buildApp(false)).get('/bad');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { id: 1 }, error: null });
    });
  });

  describe('assertMatchesSchema', () => {
    it('returns parsed data on success', () => {
      const data = assertMatchesSchema(envelopedRiskResultSchema, {
        data: {
          walletAddress: 'G' + 'A'.repeat(55),
          riskScore: 72,
          creditLimit: '720',
          interestRateBps: 640,
          message: 'ok',
        },
        error: null,
      });
      expect(data.error).toBeNull();
      expect(data.data?.riskScore).toBe(72);
    });

    it('throws with field paths on mismatch', () => {
      expect(() =>
        assertMatchesSchema(
          envelopedRiskResultSchema,
          { data: { walletAddress: 'bad' }, error: null },
          'risk.evaluate',
        ),
      ).toThrow(/Schema validation failed for risk\.evaluate/);
    });

    it('accepts standard error envelopes', () => {
      const body = assertMatchesSchema(errorEnvelopeSchema, {
        data: null,
        error: 'Validation failed',
        details: [{ field: 'walletAddress', message: 'Required' }],
      });
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('toValidationDetails', () => {
    it('maps nested paths', () => {
      const schema = z.object({ user: z.object({ email: z.string().email() }) });
      const result = schema.safeParse({ user: { email: 'nope' } });
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = toValidationDetails(result.error);
        expect(details[0].field).toBe('user.email');
        expect(details[0].message).toBeTruthy();
      }
    });
  });

  describe('request + response pipeline', () => {
    beforeEach(() => {
      process.env.ENABLE_RESPONSE_VALIDATION = 'true';
    });

    it('rejects invalid request with stable validation envelope', async () => {
      const bodySchema = z.object({ amount: z.string().regex(/^\d+$/) }).strict();
      const responseSchema = apiEnvelopeSchema(z.object({ amount: z.string() }).strict());
      const app = express();
      app.use(express.json());
      app.post(
        '/',
        validateBody(bodySchema),
        validateResponse(responseSchema),
        (req, res) => {
          res.json({ data: { amount: req.body.amount }, error: null });
        },
      );

      const res = await request(app).post('/').send({ amount: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        data: null,
        error: 'Validation failed',
      });
      expect(Array.isArray(res.body.details)).toBe(true);
    });
  });
});
