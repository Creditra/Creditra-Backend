# Creditra Backend

API and services for the Creditra adaptive credit protocol: credit lines, risk evaluation, and (future) Horizon listener and interest accrual.

## About

This service provides:

- **API gateway** — REST endpoints for credit lines and risk evaluation
- **Health check** — `/health` for readiness
- **Planned:** Risk engine (wallet history, scoring), Horizon listener (events → DB), interest accrual, liquidity pool manager

Stack: **Node.js**, **Express**, **TypeScript**.

## Tech Stack

- **Express** — HTTP API
- **TypeScript** — ESM, strict mode
- **tsx** — dev run with watch

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn

### Install and run

```bash
cd creditra-backend
npm install
```

**Development (watch):**

```bash
npm run dev
```

**Production:**

```bash
npm run build
npm start
```

API base: [http://localhost:3000](http://localhost:3000).

### Environment

| Variable    | Required | Description                                              |
|-------------|----------|----------------------------------------------------------|
| `PORT`      | No       | Server port (default: `3000`)                            |
| `API_KEYS`  | **Yes**  | Comma-separated list of valid admin API keys (see below) |

Optional later: `DATABASE_URL`, `REDIS_URL`, `HORIZON_URL`, etc.

## Authentication

Admin and internal endpoints are protected by an **API key** sent in the
`X-API-Key` HTTP header.

### Configuring API keys

Set the `API_KEYS` environment variable to a comma-separated list of secret
keys before starting the service:

```bash
export API_KEYS="key-abc123,key-def456"
npm run dev
```

The service **will not start** (throws at boot) if `API_KEYS` is unset or
empty, preventing accidental exposure of unprotected admin routes.

### Making authenticated requests

```bash
curl -X POST http://localhost:3000/api/credit/lines/42/suspend \
  -H "X-API-Key: key-abc123"
```

| Result | Condition |
|--------|-----------|
| `401 Unauthorized` | `X-API-Key` header is absent |
| `403 Forbidden`    | Header present but key is not in `API_KEYS` |
| `200 OK`           | Key matches one of the configured valid keys |

> **Security note:** The value of an invalid key is **never** included in
> error responses or server logs. Always use HTTPS in production.

### Protected endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/credit/lines/:id/suspend` | Suspend an active credit line |
| `POST` | `/api/credit/lines/:id/close`   | Permanently close a credit line |
| `POST` | `/api/risk/admin/recalibrate`   | Trigger risk model recalibration |

Public endpoints (`GET /api/credit/lines`, `POST /api/risk/evaluate`, etc.)
do **not** require a key.

### Rotating API keys

Use a **rolling rotation** to avoid downtime:

1. Add the new key to `API_KEYS` (keep the old key alongside it).
2. Deploy / restart the service.
3. Update all clients and CI secrets to use the new key.
4. Remove the old key from `API_KEYS` and redeploy.

This ensures no requests are rejected during the transition window.

## API (current)

### Public

- `GET  /health` — Service health
- `GET  /api/credit/lines` — List credit lines (placeholder)
- `GET  /api/credit/lines/:id` — Get credit line by id (placeholder)
- `POST /api/risk/evaluate` — Risk evaluation; body: `{ "walletAddress": "..." }`

### Admin (requires `X-API-Key`)

- `POST /api/credit/lines/:id/suspend` — Suspend a credit line
- `POST /api/credit/lines/:id/close` — Close a credit line
- `POST /api/risk/admin/recalibrate` — Trigger risk model recalibration

## Running tests

```bash
npm test            # run once with coverage report
npm run test:watch  # interactive watch mode
```

Target: ≥ 95 % coverage on all middleware and route files.

## Project layout

```
src/
  config/
    apiKeys.ts         # loads + validates API_KEYS env var
  middleware/
    auth.ts            # requireApiKey Express middleware
  routes/
    credit.ts          # credit-line endpoints (public + admin)
    risk.ts            # risk endpoints (public + admin)
  __tests__/
    auth.test.ts       # middleware unit tests
    credit.test.ts     # credit route integration tests
    risk.test.ts       # risk route integration tests
  index.ts             # app entry, middleware wiring, route mounting
```

## Merging to remote

This repo is a standalone git repository. After adding your remote:

```bash
git remote add origin <your-creditra-backend-repo-url>
git push -u origin main
```
