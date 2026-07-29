#!/usr/bin/env node
/**
 * Minimal end-to-end smoke test for staging/production deploys.
 *
 * Validates a handful of critical flows respond correctly WITHOUT any
 * destructive or chain-writing operation: health, an admin-auth boundary
 * check, listing credit lines, and a draw simulation (preflight-only,
 * touches no state). Exits non-zero on any failure so it can gate a
 * deploy pipeline.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://staging.example.com node scripts/smoke/run.mjs
 *
 * Env vars:
 *   SMOKE_BASE_URL   Target server (default http://localhost:3000)
 *   SMOKE_ADMIN_KEY  Optional X-Admin-Api-Key to also check an admin route
 *                    returns 401 without it and non-401 with it. Skipped
 *                    (not failed) when unset, since staging admin keys are
 *                    not always shared with CI.
 */

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const adminKey = process.env.SMOKE_ADMIN_KEY;

let failures = 0;

function report(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[smoke] ${status} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function checkHealth() {
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json().catch(() => null);
  report('GET /health', res.status === 200 && body?.status === 'ok', `status=${res.status}`);
}

async function checkCreditLinesList() {
  const res = await fetch(`${baseUrl}/api/credit/lines?offset=0&limit=1`);
  const body = await res.json().catch(() => null);
  report(
    'GET /api/credit/lines',
    res.status === 200 && Array.isArray(body?.data?.creditLines),
    `status=${res.status}`,
  );
}

async function checkDrawSimulateReachable() {
  // A nonexistent id is expected: this only proves the route is wired,
  // validated, and reachable — it performs no chain write either way.
  const res = await fetch(`${baseUrl}/api/credit/lines/00000000-0000-0000-0000-000000000000/draw/simulate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: '1' }),
  });
  report(
    'POST /api/credit/lines/:id/draw/simulate (route reachable)',
    res.status === 404 || res.status === 400,
    `status=${res.status}`,
  );
}

async function checkAdminAuthBoundary() {
  const unauth = await fetch(`${baseUrl}/api/admin/api-keys`);
  report('GET /api/admin/api-keys without key is rejected', unauth.status === 401, `status=${unauth.status}`);

  if (!adminKey) {
    console.log('[smoke] SKIP admin-key-accepted check (SMOKE_ADMIN_KEY not set)');
    return;
  }
  const authed = await fetch(`${baseUrl}/api/admin/api-keys`, {
    headers: { 'x-admin-api-key': adminKey },
  });
  report('GET /api/admin/api-keys with key succeeds', authed.status === 200, `status=${authed.status}`);
}

async function main() {
  console.log(`[smoke] target: ${baseUrl}`);
  await checkHealth();
  await checkCreditLinesList();
  await checkDrawSimulateReachable();
  await checkAdminAuthBoundary();

  if (failures > 0) {
    console.error(`[smoke] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('[smoke] all checks passed');
}

main().catch((error) => {
  console.error('[smoke] unexpected error:', error);
  process.exit(1);
});
