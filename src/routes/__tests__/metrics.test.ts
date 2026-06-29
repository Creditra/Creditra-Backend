import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { metricsRouter, recordRequest } from '../metrics.js';

type Method = 'get';

interface InvokeArgs {
  method: Method;
  path: string;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeRoute(args: InvokeArgs): Promise<{ status: number; body: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = metricsRouter.stack.find(
    (entry: any) =>
      entry.route?.path === args.path &&
      entry.route?.methods?.[args.method] === true,
  );

  if (!layer) {
    throw new Error(`Route not found: ${args.method.toUpperCase()} ${args.path}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Array<(req: Request, res: Response, next: NextFunction) => unknown> =
    layer.route.stack.map((s: any) => s.handle); // eslint-disable-line @typescript-eslint/no-explicit-any

  let statusCode = 200;
  let responseBody: unknown = null;

  const req = {
    headers: args.headers ?? {},
    method: args.method.toUpperCase(),
    path: args.path,
  } as unknown as Request;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;

  const runHandlers = async (index: number): Promise<void> => {
    if (index >= handlers.length) return;
    await new Promise<void>((resolve) => {
      handlers[index](req, res, () => {
        resolve();
        runHandlers(index + 1);
      });
    });
  };

  // Execute the first handler (auth guard); if it calls next, proceed to the route handler.
  await new Promise<void>((resolve) => {
    let nextCalled = false;
    handlers[0](req, res, () => {
      nextCalled = true;
      resolve();
    });
    if (!nextCalled) resolve();
  });

  if (statusCode === 200 && handlers.length > 1) {
    // Auth passed, run remaining handlers.
    for (let i = 1; i < handlers.length; i++) {
      await new Promise<void>((resolve) => {
        handlers[i](req, res, resolve as NextFunction);
        resolve();
      });
    }
  }

  return { status: statusCode, body: responseBody };
}

describe('GET /api/metrics', () => {
  const originalToken = process.env.METRICS_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = originalToken;
    }
  });

  it('returns 401 when no Authorization header is provided', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    const result = await invokeRoute({ method: 'get', path: '/' });
    expect(result.status).toBe(401);
    const body = result.body as { error: string };
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when wrong token is provided', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    const result = await invokeRoute({
      method: 'get',
      path: '/',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(result.status).toBe(401);
  });

  it('returns 503 when METRICS_TOKEN is not configured', async () => {
    delete process.env.METRICS_TOKEN;
    const result = await invokeRoute({ method: 'get', path: '/' });
    expect(result.status).toBe(503);
  });

  it('returns metrics payload with correct shape when authenticated', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    recordRequest(120, false);
    recordRequest(250, false);
    recordRequest(600, true);

    const result = await invokeRoute({
      method: 'get',
      path: '/',
      headers: { authorization: 'Bearer secret-token' },
    });

    expect(result.status).toBe(200);
    const body = result.body as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      uptimeSeconds: expect.any(Number),
      windowSeconds: 60,
      totalRequests: expect.any(Number),
      errorCount: expect.any(Number),
      errorRate: expect.any(Number),
      latencyMs: {
        p50: expect.any(Number),
        p95: expect.any(Number),
        p99: expect.any(Number),
      },
      sloTargets: {
        availabilityTarget: 0.999,
        p95LatencyTargetMs: 300,
        errorRateTarget: 0.001,
      },
    });
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
