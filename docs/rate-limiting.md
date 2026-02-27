Rate Limiting

- Protects public endpoints from abuse and accidental overload
- Applies to:
  - POST /api/risk/evaluate
  - GET /api/credit/lines
- Returns HTTP 429 with a JSON envelope { data: null, error: string } and a Retry-After header

Configuration

- Environment variables:
  - RATE_LIMIT_ENABLED=true|false
  - RATE_LIMIT_WINDOW_MS=window size in milliseconds
  - RATE_LIMIT_MAX_PUBLIC=max requests per window per client
  - RATE_LIMIT_MESSAGE=custom error message
- Defaults:
  - development: window 1000ms, max 50
  - production: window 60000ms, max 30

Implementation Notes

- In-memory counter keyed by client IP or X-Forwarded-For
- Pluggable store interface compatible with future Redis implementation
