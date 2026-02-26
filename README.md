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
| `LOG_LEVEL` | Logging level: debug, info, warn, error (default: info) |
| `NODE_ENV` | Environment: development, production (affects error details) |

Optional later: `DATABASE_URL`, `REDIS_URL`, `HORIZON_URL`, etc.

## API (current)

- `GET /health` — Service health
- `GET /api/credit/lines` — List credit lines (placeholder)
- `GET /api/credit/lines/:id` — Get credit line by id (placeholder)
- `POST /api/risk/evaluate` — Request risk evaluation; body: `{ "walletAddress": "..." }`

## Project layout

- `src/index.ts` — App entry, middleware, route mounting
- `src/routes/` — credit and risk route handlers
- `src/logger.ts` — Structured JSON logging utility
- `src/middleware/` — Express middleware (correlation, logging, error handling)
- `docs/LOGGING.md` — Logging and correlation ID documentation

## Features

### Structured Logging and Correlation IDs

All requests are traced end-to-end with correlation IDs. Logs are output as JSON for easy parsing and analysis.

- **Correlation IDs**: Automatically generated or client-provided via `x-correlation-id` header
- **JSON logs**: Structured output with timestamps, levels, and context
- **Sensitive data redaction**: Automatic filtering of private keys, secrets, passwords
- **Request tracing**: Log incoming requests, responses, and errors with timing

See [docs/LOGGING.md](docs/LOGGING.md) for detailed documentation.

Example log output:
```json
{
  "timestamp": "2026-02-26T10:30:45.123Z",
  "level": "info",
  "message": "Request completed",
  "context": {
    "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "method": "POST",
    "path": "/api/risk/evaluate",
    "statusCode": 200,
    "durationMs": 45
  }
}
```

## Testing

Run the test suite:

```bash
npm test                 # Run all tests
npm run test:coverage    # Run with coverage report (95%+ required)
npm run test:watch       # Watch mode for development
```

## Merging to remote

This repo is a standalone git repository. After adding your remote:

```bash
git remote add origin <your-creditra-backend-repo-url>
git push -u origin main
```
