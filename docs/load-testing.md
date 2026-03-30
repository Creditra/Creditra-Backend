# Load Testing

This document describes the load testing harness for the Creditra Backend API, including baseline SLO numbers, test scenarios, and execution instructions.

## Overview

The load testing suite uses [k6](https://k6.io/), an open-source load testing tool designed for testing the performance of APIs, microservices, and websites. k6 is written in Go and uses JavaScript for test scripts.

## Prerequisites

### Installing k6

**macOS (Homebrew):**
```bash
brew install k6
```

**Windows (Chocolatey):**
```bash
choco install k6
```

**Windows (winget):**
```bash
winget install k6 --source winget
```

**Linux (Debian/Ubuntu):**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Docker:**
```bash
docker pull grafana/k6:latest
```

For other platforms, see the [official k6 installation guide](https://k6.io/docs/get-started/installation/).

## Test Scenarios

All test scripts are located in `scripts/load/` and can be run locally or in CI.

### 1. Smoke Test (`smoke.js`)

**Purpose:** Quick validation that the API handles basic load without errors.

**Profile:**
- Duration: ~2 minutes
- Virtual Users: 10 concurrent users
- Endpoints tested: `/health`, `/api/credit/lines`, `/api/risk/evaluate`

**SLO Targets:**
- p95 latency: < 500ms
- Error rate: < 5%

**Run locally:**
```bash
npm run load:smoke
```

**Run with custom base URL:**
```bash
BASE_URL=http://localhost:3000 k6 run scripts/load/smoke.js
```

### 2. Stress Test (`stress.js`)

**Purpose:** Determine system behavior under sustained high load.

**Profile:**
- Duration: ~8 minutes
- Virtual Users: Ramps from 0 → 50 → 100 → 0
- Weighted scenarios: 60% reads, 30% risk evaluations, 10% specific lookups

**SLO Targets:**
- p95 latency: < 1000ms
- Error rate: < 10%

**Run locally:**
```bash
k6 run scripts/load/stress.js
```

### 3. Spike Test (`spike.js`)

**Purpose:** Test system resilience during sudden traffic surges.

**Profile:**
- Duration: ~3 minutes
- Virtual Users: Sudden spike from 10 → 200 → 10 → 0
- Focus: Health checks and list operations

**SLO Targets:**
- p95 latency: < 2000ms
- Error rate: < 15%

**Run locally:**
```bash
k6 run scripts/load/spike.js
```

## Baseline SLO Numbers

These are the target Service Level Objectives (SLOs) for the Creditra Backend API under concurrent load:

| Metric | Smoke Test | Stress Test | Spike Test |
|--------|------------|-------------|------------|
| **p95 Latency** | < 500ms | < 1000ms | < 2000ms |
| **p99 Latency** | < 1000ms | < 2000ms | < 3000ms |
| **Error Rate** | < 5% | < 10% | < 15% |
| **Throughput** | ~20 req/s | ~100 req/s | ~200 req/s (peak) |

### Interpreting Results

k6 provides detailed output including:

- **http_req_duration**: Request latency (avg, min, med, max, p90, p95)
- **http_req_failed**: Percentage of failed requests
- **http_reqs**: Total number of requests and requests per second
- **iterations**: Number of complete test iterations
- **vus**: Current number of virtual users

**Example output:**
```
     ✓ health status is 200
     ✓ list credit lines status is 200
     ✓ risk evaluate status is 200

     checks.........................: 100.00% ✓ 1500      ✗ 0
     data_received..................: 450 kB  7.5 kB/s
     data_sent......................: 150 kB  2.5 kB/s
     http_req_blocked...............: avg=1.2ms    min=0s     med=1ms    max=15ms   p(95)=3ms
     http_req_duration..............: avg=120ms    min=50ms   med=100ms  max=450ms  p(95)=280ms
       { expected_response:true }...: avg=120ms    min=50ms   med=100ms  max=450ms  p(95)=280ms
     http_req_failed................: 0.00%   ✓ 0         ✗ 1500
     http_reqs......................: 1500    25/s
     iterations.....................: 500     8.33/s
```

## Running in CI

The smoke test is designed to run in CI pipelines with short duration. Add to `.github/workflows/ci.yml`:

```yaml
- name: Load Test (Smoke)
  run: |
    npm run build
    npm start &
    sleep 5  # Wait for server to start
    npm run load:smoke
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | API base URL to test against |

**Example:**
```bash
BASE_URL=https://staging.creditra.example.com k6 run scripts/load/smoke.js
```

## Security and Operations Notes

### Authentication

The current test scripts focus on public endpoints (`/health`, `/api/credit/lines`, `/api/risk/evaluate`). To test admin endpoints that require `X-API-Key`:

1. Set the API key in the test script:
```javascript
const params = {
  headers: {
    'X-API-Key': __ENV.API_KEY || 'test-key',
  },
};
```

2. Run with the environment variable:
```bash
API_KEY=your-secret-key k6 run scripts/load/admin-test.js
```

**⚠️ Security Warning:** Never commit API keys to version control. Use environment variables or CI secrets.

### PII and Test Data

- The test scripts use synthetic wallet addresses that follow Stellar format but are not real accounts.
- No Personally Identifiable Information (PII) is used in load tests.
- Risk evaluation endpoints receive placeholder addresses only.

### Stellar Keys

- Load tests do NOT interact with Stellar Horizon or use private keys.
- Tests only exercise the REST API layer, not blockchain operations.
- For integration tests involving Stellar, use testnet accounts only.

### Rate Limiting

If the API implements rate limiting in the future:

- Adjust virtual user counts and ramp-up times accordingly
- Monitor for `429 Too Many Requests` responses
- Update thresholds to account for expected rate limit behavior

### Database Considerations

- Load tests may create temporary data in the database (if using persistent storage).
- Use a dedicated test database or in-memory repositories for load testing.
- Clean up test data after runs if necessary.

## Troubleshooting

### Server not responding

```bash
# Check if server is running
curl http://localhost:3000/health

# Start the server
npm run dev
```

### High error rates

- Check server logs for errors
- Verify database connections
- Ensure sufficient system resources (CPU, memory)
- Reduce virtual user count if testing on limited hardware

### Timeouts

- Increase timeout thresholds in test scripts if infrastructure is slower
- Check network latency between test runner and API
- Monitor server resource utilization

## Future Enhancements

- Add soak tests (long-duration, moderate load)
- Implement breakpoint tests (find maximum capacity)
- Add distributed load testing for multi-region scenarios
- Integrate with monitoring tools (Prometheus, Grafana)
- Add custom metrics for business-specific KPIs

## References

- [k6 Documentation](https://k6.io/docs/)
- [k6 Test Types](https://k6.io/docs/test-types/introduction/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [k6 Metrics](https://k6.io/docs/using-k6/metrics/)
