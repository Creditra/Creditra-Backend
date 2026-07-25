/**
 * Integration suite: auth boundaries (RBAC + API keys).
 *
 * Verifies every sensitive route is protected by the correct credential and
 * that cross-role credentials are rejected. Negative cases cover missing,
 * invalid, and insufficient-permission credentials. Secrets must never appear
 * in response bodies.
 *
 * Roles (docs/SECURITY.md §3):
 *  - api-key  → X-API-Key       (risk recalibrate, reconciliation)
 *  - admin    → X-Admin-Api-Key (credit suspend/close, api-keys, maintenance)
 *  - metrics  → Bearer token    (metrics export)
 *
 * Runs against the in-memory DI container (no external DB required); CI
 * ephemeral Postgres is therefore not a dependency of this suite.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createCreditLine, _resetStore } from '../src/services/creditService.js';
import { setMaintenanceMode } from '../src/middleware/maintenanceMode.js';
import {
  AUTH_FIXTURES,
  installAuthEnv,
  snapshotAuthEnv,
  restoreAuthEnv,
  withApiKey,
  withAdminKey,
  withMetricsToken,
  withInvalidApiKey,
  withInvalidAdminKey,
  withInvalidMetricsToken,
  withWrongRoleForApiKeyRoute,
  withWrongRoleForAdminRoute,
  withWrongRoleForMetricsRoute,
  expectNoSecretLeak,
  API_KEY_HEADER,
  ADMIN_KEY_HEADER,
} from './helpers/auth.js';

const ALL_SECRETS = [
  AUTH_FIXTURES.apiKey,
  AUTH_FIXTURES.adminKey,
  AUTH_FIXTURES.metricsToken,
  AUTH_FIXTURES.invalidApiKey,
  AUTH_FIXTURES.invalidAdminKey,
  AUTH_FIXTURES.invalidMetricsToken,
];

const LINE_ID = 'auth-boundary-line-1';

let envSnapshot: ReturnType<typeof snapshotAuthEnv>;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  envSnapshot = snapshotAuthEnv();
  installAuthEnv();
  app = createApp();
});

afterAll(() => {
  restoreAuthEnv(envSnapshot);
});

beforeEach(() => {
  // Keep auth env stable even if a nested test temporarily mutates it.
  installAuthEnv();
  _resetStore();
  setMaintenanceMode(false, 'auth-boundary-test-setup');
  createCreditLine(LINE_ID);
});

// ---------------------------------------------------------------------------
// Public endpoints must remain reachable without credentials
// ---------------------------------------------------------------------------

describe('public endpoints remain unauthenticated', () => {
  it('GET /health → 200 without credentials', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'creditra-backend' });
  });

  it('GET /api/credit/lines → 200 without credentials', async () => {
    const res = await request(app).get('/api/credit/lines');
    expect(res.status).toBe(200);
  });

  it('GET /api/dashboard/summary → 200 without credentials', async () => {
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
  });

  it('POST /api/risk/evaluate → not blocked by auth (validation only)', async () => {
    const res = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    // Auth must not reject; may be 200 (success) or domain error — never 401/403.
    expect([401, 403]).not.toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Credit admin actions — X-Admin-Api-Key (admin role)
// ---------------------------------------------------------------------------

describe('credit admin actions (admin role / X-Admin-Api-Key)', () => {
  describe.each([
    ['POST', `/api/credit/lines/${LINE_ID}/suspend`],
    ['POST', `/api/credit/lines/${LINE_ID}/close`],
  ] as const)('%s %s', (method, path) => {
    it('returns 401 when credentials are missing', async () => {
      const res = await request(app)[method.toLowerCase() as 'post'](path);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
      expectNoSecretLeak(res.body, ALL_SECRETS);
    });

    it('returns 401 when admin key is invalid', async () => {
      const res = await withInvalidAdminKey(
        request(app)[method.toLowerCase() as 'post'](path),
      );
      expect(res.status).toBe(401);
      expectNoSecretLeak(res.body, ALL_SECRETS);
    });

    it('returns 401 when partner API key is presented (insufficient role)', async () => {
      const res = await withWrongRoleForAdminRoute(
        request(app)[method.toLowerCase() as 'post'](path),
      );
      // adminAuth only inspects X-Admin-Api-Key; X-API-Key alone is treated as missing.
      expect(res.status).toBe(401);
      expectNoSecretLeak(res.body, ALL_SECRETS);
    });

    it('returns 401 when metrics bearer is presented (insufficient role)', async () => {
      const res = await withMetricsToken(
        request(app)[method.toLowerCase() as 'post'](path),
      );
      expect(res.status).toBe(401);
    });

    it('returns 200 with a valid admin key', async () => {
      // close requires the line to still exist; re-create if a prior case closed it.
      createCreditLine(`${LINE_ID}-${method}`);
      const target = path.replace(LINE_ID, `${LINE_ID}-${method}`);
      const res = await withAdminKey(
        request(app)[method.toLowerCase() as 'post'](target),
      );
      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Risk config — X-API-Key (api-key role)
// ---------------------------------------------------------------------------

describe('risk config admin (api-key role / X-API-Key)', () => {
  const path = '/api/risk/admin/recalibrate';

  it('returns 401 when credentials are missing', async () => {
    const res = await request(app).post(path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 when API key is invalid', async () => {
    const res = await withInvalidApiKey(request(app).post(path));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expectNoSecretLeak(res.body, ALL_SECRETS);
  });

  it('returns 401 when admin key is presented instead (insufficient role)', async () => {
    // Wrong header entirely — middleware sees no X-API-Key.
    const res = await withWrongRoleForApiKeyRoute(request(app).post(path));
    expect(res.status).toBe(401);
  });

  it('returns 401 when metrics bearer is presented (insufficient role)', async () => {
    const res = await withMetricsToken(request(app).post(path));
    expect(res.status).toBe(401);
  });

  it('returns 403 when admin key value is stuffed into X-API-Key header', async () => {
    // Same secret string, wrong role surface — admin key is not in API_KEYS set.
    const res = await request(app)
      .post(path)
      .set(API_KEY_HEADER, AUTH_FIXTURES.adminKey);
    expect(res.status).toBe(403);
  });

  it('returns 200 with a valid API key', async () => {
    const res = await withApiKey(request(app).post(path));
    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/recalibration/i);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation control plane — X-API-Key
// ---------------------------------------------------------------------------

describe('reconciliation control plane (api-key role / X-API-Key)', () => {
  describe.each([
    ['POST', '/api/reconciliation/trigger'],
    ['GET', '/api/reconciliation/status'],
  ] as const)('%s %s', (method, path) => {
    const verb = method.toLowerCase() as 'get' | 'post';

    it('returns 401 when credentials are missing', async () => {
      const res = await request(app)[verb](path);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
    });

    it('returns 403 when API key is invalid', async () => {
      const res = await withInvalidApiKey(request(app)[verb](path));
      expect(res.status).toBe(403);
      expectNoSecretLeak(res.body, ALL_SECRETS);
    });

    it('returns 401 when admin key is presented (insufficient role)', async () => {
      const res = await withWrongRoleForApiKeyRoute(request(app)[verb](path));
      expect(res.status).toBe(401);
    });

    it('succeeds with a valid API key', async () => {
      const res = await withApiKey(request(app)[verb](path));
      // trigger → 202, status → 200
      expect([200, 202]).toContain(res.status);
      expect(res.body.error).toBeNull();
      expect(res.body.data).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// API key lifecycle + audit queries — X-Admin-Api-Key
// ---------------------------------------------------------------------------

describe('API key admin + audit queries (admin role / X-Admin-Api-Key)', () => {
  describe.each([
    ['GET', '/api/admin/api-keys'],
    ['POST', '/api/admin/api-keys'],
    ['GET', '/api/admin/api-keys/audit'],
  ] as const)('%s %s', (method, path) => {
    const verb = method.toLowerCase() as 'get' | 'post';

    it('returns 401 when credentials are missing', async () => {
      const res = await request(app)[verb](path).send(method === 'POST' ? { label: 'x' } : undefined);
      expect(res.status).toBe(401);
      expectNoSecretLeak(res.body, ALL_SECRETS);
    });

    it('returns 401 when admin key is invalid', async () => {
      const res = await withInvalidAdminKey(
        request(app)[verb](path).send(method === 'POST' ? { label: 'x' } : undefined),
      );
      expect(res.status).toBe(401);
      expectNoSecretLeak(res.body, ALL_SECRETS);
    });

    it('returns 401 when partner API key is presented (insufficient role)', async () => {
      const res = await withWrongRoleForAdminRoute(
        request(app)[verb](path).send(method === 'POST' ? { label: 'x' } : undefined),
      );
      expect(res.status).toBe(401);
    });
  });

  it('POST issues a key, GET lists metadata without secrets, GET audit returns log', async () => {
    const created = await withAdminKey(
      request(app).post('/api/admin/api-keys').send({ label: 'auth-boundary-suite' }),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.key).toMatch(/^ck_/);
    const issuedPlaintext: string = created.body.data.key;
    const id: string = created.body.data.id;

    const listed = await withAdminKey(request(app).get('/api/admin/api-keys'));
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.data)).toBe(true);
    // List must never echo plaintext keys.
    expect(JSON.stringify(listed.body)).not.toContain(issuedPlaintext);

    const audit = await withAdminKey(request(app).get('/api/admin/api-keys/audit'));
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body.data)).toBe(true);
    expect(audit.body.data.some((e: { action: string }) => e.action === 'issued')).toBe(true);
    expect(JSON.stringify(audit.body)).not.toContain(issuedPlaintext);

    const revoked = await withAdminKey(request(app).delete(`/api/admin/api-keys/${id}`));
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('revoked');
  });

  it('DELETE /api/admin/api-keys/:id returns 401 without admin key', async () => {
    const res = await request(app).delete('/api/admin/api-keys/any-id');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Maintenance mode admin — X-Admin-Api-Key
// ---------------------------------------------------------------------------

describe('maintenance mode admin (admin role / X-Admin-Api-Key)', () => {
  it('GET /api/admin/maintenance returns 401 without credentials', async () => {
    const res = await request(app).get('/api/admin/maintenance');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/maintenance returns 401 with partner API key', async () => {
    const res = await withWrongRoleForAdminRoute(request(app).get('/api/admin/maintenance'));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/maintenance returns status + audit with admin key', async () => {
    const res = await withAdminKey(request(app).get('/api/admin/maintenance'));
    expect(res.status).toBe(200);
    expect(typeof res.body.maintenanceMode).toBe('boolean');
    expect(Array.isArray(res.body.auditLog)).toBe(true);
  });

  it('POST /api/admin/maintenance rejects missing and wrong-role credentials', async () => {
    const missing = await request(app).post('/api/admin/maintenance').send({ enabled: true });
    expect(missing.status).toBe(401);

    const wrongRole = await withApiKey(
      request(app).post('/api/admin/maintenance').send({ enabled: true }),
    );
    expect(wrongRole.status).toBe(401);

    const invalid = await withInvalidAdminKey(
      request(app).post('/api/admin/maintenance').send({ enabled: true }),
    );
    expect(invalid.status).toBe(401);
  });

  it('POST /api/admin/maintenance toggles with a valid admin key', async () => {
    const enable = await withAdminKey(
      request(app).post('/api/admin/maintenance').send({ enabled: true }),
    );
    expect(enable.status).toBe(200);
    expect(enable.body.maintenanceMode).toBe(true);

    const disable = await withAdminKey(
      request(app).post('/api/admin/maintenance').send({ enabled: false }),
    );
    expect(disable.status).toBe(200);
    expect(disable.body.maintenanceMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Metrics export — Bearer METRICS_TOKEN
// ---------------------------------------------------------------------------

describe('metrics export (metrics role / Bearer token)', () => {
  const path = '/api/metrics';

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when bearer token is invalid', async () => {
    const res = await withInvalidMetricsToken(request(app).get(path));
    expect(res.status).toBe(401);
    expectNoSecretLeak(res.body, ALL_SECRETS);
  });

  it('returns 401 when API key is presented as bearer (insufficient role)', async () => {
    const res = await withWrongRoleForMetricsRoute(request(app).get(path));
    expect(res.status).toBe(401);
  });

  it('returns 401 when admin key is sent as X-Admin-Api-Key only', async () => {
    const res = await withAdminKey(request(app).get(path));
    expect(res.status).toBe(401);
  });

  it('returns 200 with a valid metrics bearer token', async () => {
    const res = await withMetricsToken(request(app).get(path));
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toMatchObject({
      uptimeSeconds: expect.any(Number),
      windowSeconds: 60,
      latencyMs: {
        p50: expect.any(Number),
        p95: expect.any(Number),
        p99: expect.any(Number),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Webhooks — operational surface (currently unauthenticated; no secret leak)
// ---------------------------------------------------------------------------

describe('webhook operational surface', () => {
  it('GET /api/webhooks/config is reachable and never returns webhook secrets', async () => {
    const res = await request(app).get('/api/webhooks/config');
    expect(res.status).toBe(200);
    // Config is public-read for ops dashboards; secrets must stay server-side.
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/secret|password|hmac/i);
    expect(res.body).not.toHaveProperty('secret');
    expect(res.body).not.toHaveProperty('webhookSecret');
  });

  it('GET /api/webhooks/health is reachable without credentials', async () => {
    const res = await request(app).get('/api/webhooks/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
  });

  it('POST /api/webhooks/test does not require API/admin keys (connectivity probe)', async () => {
    const res = await request(app).post('/api/webhooks/test');
    // Unconfigured webhooks still return 200 with empty/zero results.
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('results');
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour when secrets are unset
// ---------------------------------------------------------------------------

describe('fail-closed when auth secrets are unset', () => {
  it('admin routes return 503 when ADMIN_API_KEY is not configured', async () => {
    delete process.env.ADMIN_API_KEY;
    try {
      const res = await request(app)
        .post(`/api/credit/lines/${LINE_ID}/suspend`)
        .set(ADMIN_KEY_HEADER, AUTH_FIXTURES.adminKey);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not configured/i);
    } finally {
      installAuthEnv();
    }
  });

  it('metrics export returns 503 when METRICS_TOKEN is not configured', async () => {
    delete process.env.METRICS_TOKEN;
    try {
      const res = await withMetricsToken(request(app).get('/api/metrics'));
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/not enabled|not configured/i);
    } finally {
      installAuthEnv();
    }
  });

  it('api-key routes reject after API_KEYS is cleared (no open access)', async () => {
    // Clearing API_KEYS makes loadApiKeys() throw inside the middleware.
    // Access must not succeed (anything other than 2xx is acceptable fail-closed).
    delete process.env.API_KEYS;
    try {
      const res = await request(app)
        .post('/api/risk/admin/recalibrate')
        .set(API_KEY_HEADER, AUTH_FIXTURES.apiKey);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
    } finally {
      installAuthEnv();
    }
  });
});

// ---------------------------------------------------------------------------
// Header confusion / wrong header name
// ---------------------------------------------------------------------------

describe('header confusion does not bypass auth', () => {
  it('Authorization: Bearer <api-key> does not unlock X-API-Key routes', async () => {
    const res = await request(app)
      .post('/api/risk/admin/recalibrate')
      .set('Authorization', `Bearer ${AUTH_FIXTURES.apiKey}`);
    expect(res.status).toBe(401);
  });

  it('X-API-Key does not unlock X-Admin-Api-Key routes even with admin secret value', async () => {
    const res = await request(app)
      .post(`/api/credit/lines/${LINE_ID}/suspend`)
      .set(API_KEY_HEADER, AUTH_FIXTURES.adminKey);
    expect(res.status).toBe(401);
  });

  it('X-Admin-Api-Key does not unlock metrics export', async () => {
    const res = await request(app)
      .get('/api/metrics')
      .set(ADMIN_KEY_HEADER, AUTH_FIXTURES.adminKey);
    expect(res.status).toBe(401);
  });

  it('case-altered X-API-Key value is rejected (keys are case-sensitive)', async () => {
    const res = await request(app)
      .post('/api/risk/admin/recalibrate')
      .set(API_KEY_HEADER, AUTH_FIXTURES.apiKey.toUpperCase());
    expect(res.status).toBe(403);
  });
});
