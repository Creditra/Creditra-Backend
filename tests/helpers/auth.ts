/**
 * Auth-boundary test helpers.
 *
 * The backend ships two primary roles (see docs/SECURITY.md §3) plus a
 * dedicated metrics bearer token:
 *
 * | Role        | Header / scheme              | Env var          |
 * |-------------|------------------------------|------------------|
 * | api-key     | X-API-Key                    | API_KEYS         |
 * | admin       | X-Admin-Api-Key              | ADMIN_API_KEY    |
 * | metrics     | Authorization: Bearer <tok>  | METRICS_TOKEN    |
 *
 * Helpers below make authenticated Supertest chains consistent and ensure
 * tests exercise missing / invalid / wrong-role / correct-role cases.
 */
import type { Test } from 'supertest';
import { ADMIN_KEY_HEADER } from '../../src/middleware/adminAuth.js';

/** Stable fixtures used by the auth-boundary integration suite. */
export const AUTH_FIXTURES = {
  /** Partner / integration API key (X-API-Key). */
  apiKey: 'test-api-key-partner-role',
  /** Operator admin key (X-Admin-Api-Key). */
  adminKey: 'test-admin-key-operator-role',
  /** Metrics scrape token (Authorization: Bearer). */
  metricsToken: 'test-metrics-token-export-role',
  /** Deliberately wrong secrets for negative cases. */
  invalidApiKey: 'definitely-not-a-valid-api-key',
  invalidAdminKey: 'definitely-not-a-valid-admin-key',
  invalidMetricsToken: 'definitely-not-a-valid-metrics-token',
} as const;

export const API_KEY_HEADER = 'x-api-key' as const;
export { ADMIN_KEY_HEADER };

/**
 * Installs the env vars that back each auth role.
 * Call from `beforeAll` / `beforeEach` of integration suites.
 */
export function installAuthEnv(overrides: Partial<typeof AUTH_FIXTURES> = {}): void {
  const fixtures = { ...AUTH_FIXTURES, ...overrides };
  process.env.API_KEYS = fixtures.apiKey;
  process.env.ADMIN_API_KEY = fixtures.adminKey;
  process.env.METRICS_TOKEN = fixtures.metricsToken;
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
}

/**
 * Restores env after a suite that mutated auth-related variables.
 * Pass the snapshot returned by {@link snapshotAuthEnv}.
 */
export function snapshotAuthEnv(): {
  API_KEYS: string | undefined;
  ADMIN_API_KEY: string | undefined;
  METRICS_TOKEN: string | undefined;
} {
  return {
    API_KEYS: process.env.API_KEYS,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    METRICS_TOKEN: process.env.METRICS_TOKEN,
  };
}

export function restoreAuthEnv(snapshot: {
  API_KEYS: string | undefined;
  ADMIN_API_KEY: string | undefined;
  METRICS_TOKEN: string | undefined;
}): void {
  for (const [key, value] of Object.entries(snapshot) as Array<
    [keyof typeof snapshot, string | undefined]
  >) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/** Attach a valid partner API key (`X-API-Key`). */
export function withApiKey<T extends Test>(req: T, key: string = AUTH_FIXTURES.apiKey): T {
  return req.set(API_KEY_HEADER, key);
}

/** Attach a valid operator admin key (`X-Admin-Api-Key`). */
export function withAdminKey<T extends Test>(req: T, key: string = AUTH_FIXTURES.adminKey): T {
  return req.set(ADMIN_KEY_HEADER, key);
}

/** Attach a valid metrics bearer token. */
export function withMetricsToken<T extends Test>(
  req: T,
  token: string = AUTH_FIXTURES.metricsToken,
): T {
  return req.set('Authorization', `Bearer ${token}`);
}

/** Attach an invalid partner API key. */
export function withInvalidApiKey<T extends Test>(req: T): T {
  return withApiKey(req, AUTH_FIXTURES.invalidApiKey);
}

/** Attach an invalid admin key. */
export function withInvalidAdminKey<T extends Test>(req: T): T {
  return withAdminKey(req, AUTH_FIXTURES.invalidAdminKey);
}

/** Attach an invalid metrics bearer token. */
export function withInvalidMetricsToken<T extends Test>(req: T): T {
  return withMetricsToken(req, AUTH_FIXTURES.invalidMetricsToken);
}

/**
 * Wrong-role helpers: present a credential that is valid for a *different*
 * role. These assert RBAC isolation (admin key ≠ API key ≠ metrics token).
 */
export function withWrongRoleForApiKeyRoute<T extends Test>(req: T): T {
  // Admin key presented to an X-API-Key-gated route — must not grant access.
  return withAdminKey(req);
}

export function withWrongRoleForAdminRoute<T extends Test>(req: T): T {
  // Partner API key presented to an admin-gated route — must not grant access.
  return withApiKey(req);
}

export function withWrongRoleForMetricsRoute<T extends Test>(req: T): T {
  // API key presented as a metrics bearer — must not grant access.
  return withMetricsToken(req, AUTH_FIXTURES.apiKey);
}

/** Assert response body never echoes a secret value. */
export function expectNoSecretLeak(body: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(body);
  for (const secret of secrets) {
    if (!secret) continue;
    expect(serialized).not.toContain(secret);
  }
}
