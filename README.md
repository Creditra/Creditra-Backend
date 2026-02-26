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

## API (current)

- `GET /health` — Service health
- `GET /api/credit/lines` — List credit lines (placeholder)
- `GET /api/credit/lines/:id` — Get credit line by id (placeholder)
- `POST /api/risk/evaluate` — Request risk evaluation; body: `{ "walletAddress": "..." }`

## Project layout

- `src/index.ts` — App entry, middleware, route mounting
- `src/routes/` — credit and risk route handlers
- `docs/` — Documentation and guidelines

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

This repo is a standalone git repository. After adding your remote:

```bash
git remote add origin <your-creditra-backend-repo-url>
git push -u origin main
```
