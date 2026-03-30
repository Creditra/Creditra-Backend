# Load Testing Scripts

This directory contains k6 load testing scenarios for the Creditra Backend API.

## Quick Start

```bash
# Install k6 (see docs/load-testing.md for platform-specific instructions)
brew install k6  # macOS

# Run smoke test (quick validation)
npm run load:smoke

# Run stress test (sustained high load)
npm run load:stress

# Run spike test (sudden traffic surge)
npm run load:spike
```

## Scripts

| Script | Duration | Max VUs | Purpose |
|--------|----------|---------|---------|
| `smoke.js` | ~2 min | 10 | Quick validation, CI-friendly |
| `stress.js` | ~8 min | 100 | Sustained load testing |
| `spike.js` | ~3 min | 200 | Sudden traffic surge testing |

## Configuration

All scripts accept the `BASE_URL` environment variable:

```bash
BASE_URL=http://localhost:3000 k6 run scripts/load/smoke.js
```

## Output

k6 provides detailed metrics including:
- Request duration (p95, p99)
- Error rates
- Throughput (requests/second)
- Virtual user count

See [docs/load-testing.md](../../docs/load-testing.md) for full documentation.
