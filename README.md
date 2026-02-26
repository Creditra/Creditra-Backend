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

| Variable | Description |
|----------|-------------|
| `PORT`   | Server port (default: 3000) |
| `DATABASE_URL` | PostgreSQL connection string (required for migrations) |

Optional later: `REDIS_URL`, `HORIZON_URL`, etc.

## Data model and migrations

The PostgreSQL schema is designed and documented in **[docs/data-model.md](docs/data-model.md)**. It covers borrowers, credit lines, risk evaluations, transactions, and events, with indexes and security notes.

- **Migrations** live in `migrations/` as sequential SQL files. See [migrations/README.md](migrations/README.md) for strategy and naming.
- **Apply migrations:** `DATABASE_URL=... npm run db:migrate`
- **Validate schema:** `DATABASE_URL=... npm run db:validate`

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
- `POST /api/risk/evaluate` — Request risk evaluation; body: `{ "walletAddress": "..." }`

## Project layout

```
src/
  index.ts            — App entry, middleware, route mounting
  routes/             — credit and risk route handlers
  __tests__/          — Jest test suites
- `docs/` — Documentation and guidelines
  
.github/workflows/
  ci.yml              — CI pipeline
.eslintrc.cjs         — ESLint config
tsconfig.json         — TypeScript config
```

## Security

Security is a priority for Creditra. Before deploying or contributing:

- Review the [Backend Security Checklist](docs/security-checklist-backend.md)
- Ensure all security requirements are met
- Run `npm audit` to check for vulnerabilities
- Maintain minimum 95% test coverage
- `src/db/` — migration and schema validation helpers
- `docs/data-model.md` — PostgreSQL data model documentation
- `migrations/` — SQL migration files

## Merging to remote

```bash
git remote add origin <your-creditra-backend-repo-url>
git push -u origin main
```