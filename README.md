# Creditra Backend

![CI](https://github.com/Creditra/Creditra-Backend/actions/workflows/ci.yml/badge.svg)

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
- **Jest + ts-jest** — unit & integration tests
- **ESLint + @typescript-eslint** — linting

## Setup

### Prerequisites

- Node.js 20+
- npm

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
| `DATABASE_URL` | No    | PostgreSQL connection string (required for migrations)   |

Optional later: `REDIS_URL`, `HORIZON_URL`, etc.

## Data model and migrations

The PostgreSQL schema is designed and documented in **[docs/data-model.md](docs/data-model.md)**. It covers borrowers, credit lines, risk evaluations, transactions, and events, with indexes and security notes.

- **Migrations** live in `migrations/` as sequential SQL files. See [migrations/README.md](migrations/README.md) for strategy and naming.
- **Apply migrations:** `DATABASE_URL=... npm run db:migrate`
- **Validate schema:** `DATABASE_URL=... npm run db:validate`

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

## CI / Quality Gates

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request:

| Step | Command | Fails build on… |
|------|---------|-----------------|
| TypeScript typecheck | `npm run typecheck` | Any type error |
| Lint | `npm run lint` | Any ESLint warning or error |
| Tests + Coverage | `npm test` | Failing test OR coverage < 95% |

### Run locally

```bash
# Typecheck
npm run typecheck

# Lint
npm run lint

# Lint with auto-fix
npm run lint:fix

# Tests (single run + coverage report)
npm test

# Tests in watch mode
npm run test:watch
```

**Coverage threshold:** 95% lines, branches, functions, and statements (enforced by Jest).

## API (current)

- `GET /health` — Service health
- `GET /api/credit/lines` — List credit lines (placeholder)
- `GET /api/credit/lines/:id` — Get credit line by id (placeholder)
- `POST /api/risk/evaluate` — Request risk evaluation; body: `{ "walletAddress": "..." }`; returns `400` with `{ "error": "Invalid wallet address format." }` for invalid Stellar addresses
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
  db/                  # migration and schema validation helpers
docs/
  data-model.md        # PostgreSQL data model documentation
  security-checklist-backend.md
migrations/            # SQL migration files
.github/workflows/
  ci.yml               # CI pipeline
.eslintrc.cjs          # ESLint config
tsconfig.json          # TypeScript config
```

## Security

Security is a priority for Creditra. Before deploying or contributing:

- Review the [Backend Security Checklist](docs/security-checklist-backend.md)
- Ensure all security requirements are met
- Run `npm audit` to check for vulnerabilities
- Maintain minimum 95% test coverage

## Merging to remote

```bash
git remote add origin <your-creditra-backend-repo-url>
git push -u origin main
```