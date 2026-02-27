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

## Rate Limiting

The API implements rate limiting to protect against abuse, accidental overload, and denial-of-service attacks. Rate limits are enforced per client IP address and vary by endpoint and environment.

### Rate Limits by Endpoint

| Endpoint | Method | Production Limit | Development Limit | Window |
|----------|--------|-----------------|-------------------|--------|
| `/api/risk/evaluate` | POST | 20 requests | 200 requests | 15 minutes |
| `/api/credit/lines` | GET | 100 requests | 1000 requests | 15 minutes |
| `/api/credit/lines/:id` | GET | 100 requests | 1000 requests | 15 minutes |

### Rate Limit Response

When a client exceeds their rate limit, the API returns a `429 Too Many Requests` response:

```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 847,
  "limit": 20
}
```

All responses include rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 73
X-RateLimit-Reset: 2024-01-15T10:30:00.000Z
Retry-After: 847
```

### Configuration

Rate limits are configured per environment using the `NODE_ENV` variable:

- **development**: Higher limits for testing (200-1000 requests per 15 minutes)
- **staging**: Production-like limits (20-100 requests per 15 minutes)
- **production**: Strict limits (20-100 requests per 15 minutes)

### Usage Examples

The rate limiter is automatically applied to all configured endpoints. To apply rate limiting to a new endpoint:

```typescript
import { createEndpointRateLimiter } from './middleware/rateLimiterConfig';

// Apply to a specific route
const limiter = createEndpointRateLimiter({
  path: '/api/new/endpoint',
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 50
});

app.use('/api/new/endpoint', limiter, yourRouteHandler);
```

Or apply all configured rate limiters at once:

```typescript
import { applyRateLimiters } from './middleware/rateLimiterConfig';

// Apply all rate limiters based on environment
applyRateLimiters(app, process.env.NODE_ENV);
```

### Custom Store Implementation

The rate limiter uses an in-memory store by default. For distributed deployments, you can implement a custom store using the `IRateLimitStore` interface:

```typescript
import { IRateLimitStore } from './middleware/stores/IRateLimitStore';
import { createRateLimiter } from './middleware/rateLimiter';

// Example: Redis store implementation
class RedisStore implements IRateLimitStore {
  constructor(private client: RedisClient) {}

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const resetAt = now + windowMs;
    
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.pexpire(key, windowMs);
    }
    
    return { count, resetAt };
  }

  async get(key: string): Promise<number | null> {
    const count = await this.client.get(key);
    return count ? parseInt(count, 10) : null;
  }

  async reset(key: string): Promise<void> {
    await this.client.del(key);
  }

  async cleanup(): Promise<number> {
    // Redis handles expiration automatically
    return 0;
  }
}

// Use custom store
const redisStore = new RedisStore(redisClient);
const limiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  store: redisStore
});
```

### Performance

The rate limiter is designed for minimal overhead:

- Request processing: <5ms per request (P95)
- Memory efficient: ~16 bytes per client-endpoint pair
- Automatic cleanup of expired entries every 60 seconds

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