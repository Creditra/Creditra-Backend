# HTTP Timeout Configuration

This document describes the HTTP timeout configuration for outbound requests to Stellar Horizon and external risk evaluation providers.

## Overview

All outbound HTTP requests use configurable connect and read timeouts to prevent hanging connections and ensure predictable failure modes. The timeout utilities provide:

- Separate connect and read timeout configuration
- Structured error types for timeout vs. other failures
- Environment-based configuration with sensible defaults
- Consistent error handling across all HTTP clients

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_CONNECT_TIMEOUT_MS` | `5000` | Connection timeout in milliseconds (time to establish TCP connection) |
| `HTTP_READ_TIMEOUT_MS` | `10000` | Read timeout in milliseconds (time to receive complete response after connection) |

### Setting Timeouts

**Development (.env file):**
```bash
HTTP_CONNECT_TIMEOUT_MS=3000
HTTP_READ_TIMEOUT_MS=8000
```

**Production (environment):**
```bash
export HTTP_CONNECT_TIMEOUT_MS=5000
export HTTP_READ_TIMEOUT_MS=15000
```

**Docker Compose:**
```yaml
services:
  api:
    environment:
      - HTTP_CONNECT_TIMEOUT_MS=5000
      - HTTP_READ_TIMEOUT_MS=15000
```

## Usage

### Basic Fetch with Timeout

```typescript
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';

// Uses default timeouts from environment
const response = await fetchWithTimeout('https://horizon-testnet.stellar.org/ledgers');

if (response.ok) {
  const data = await response.json();
  // Process data
}
```

### JSON Fetch with Timeout

```typescript
import { fetchJsonWithTimeout } from '../utils/fetchWithTimeout.js';

interface HorizonLedgerResponse {
  _embedded: {
    records: Array<{ sequence: number; closed_at: string }>;
  };
}

try {
  const data = await fetchJsonWithTimeout<HorizonLedgerResponse>(
    'https://horizon-testnet.stellar.org/ledgers?limit=10'
  );
  
  console.log('Latest ledgers:', data._embedded.records);
} catch (error) {
  // Handle errors (see Error Handling section)
}
```

### Custom Timeout Overrides

```typescript
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';

// Override timeouts for a specific request
const response = await fetchWithTimeout('https://slow-api.example.com/data', {
  timeouts: {
    connectTimeoutMs: 10000,  // 10 seconds to connect
    readTimeoutMs: 30000,     // 30 seconds to read response
  },
  headers: {
    'Authorization': 'Bearer token',
  },
});
```

## Error Handling

The timeout utilities provide structured error types for different failure modes:

### HttpTimeoutError

Thrown when a request exceeds the configured timeout.

```typescript
import { HttpTimeoutError, fetchWithTimeout } from '../utils/fetchWithTimeout.js';

try {
  const response = await fetchWithTimeout('https://horizon-testnet.stellar.org/ledgers');
} catch (error) {
  if (error instanceof HttpTimeoutError) {
    console.error(`${error.type} timeout after ${error.timeoutMs}ms: ${error.url}`);
    // error.type is 'connect' or 'read'
    // error.timeoutMs is the timeout value that was exceeded
    // error.url is the URL that timed out
  }
}
```

### HttpRequestError

Thrown for other HTTP failures (network errors, invalid JSON, non-OK status).

```typescript
import { HttpRequestError, fetchJsonWithTimeout } from '../utils/fetchWithTimeout.js';

try {
  const data = await fetchJsonWithTimeout('https://api.example.com/data');
} catch (error) {
  if (error instanceof HttpRequestError) {
    console.error(`Request failed: ${error.message}`);
    console.error(`URL: ${error.url}`);
    if (error.cause) {
      console.error(`Cause: ${error.cause.message}`);
    }
  }
}
```

### Complete Error Handling Example

```typescript
import {
  fetchJsonWithTimeout,
  HttpTimeoutError,
  HttpRequestError,
} from '../utils/fetchWithTimeout.js';

async function fetchHorizonData(url: string) {
  try {
    return await fetchJsonWithTimeout(url);
  } catch (error) {
    if (error instanceof HttpTimeoutError) {
      // Timeout - may want to retry with exponential backoff
      console.error(`Timeout (${error.type}): ${error.url}`);
      throw new Error('Horizon API timeout - please try again');
    } else if (error instanceof HttpRequestError) {
      // Other HTTP error - check if retryable
      console.error(`HTTP error: ${error.message}`);
      if (error.cause) {
        console.error(`Underlying cause: ${error.cause.message}`);
      }
      throw new Error('Horizon API request failed');
    } else {
      // Unknown error
      console.error('Unexpected error:', error);
      throw error;
    }
  }
}
```

## Integration Points

### Horizon Listener

The Horizon listener (`src/services/horizonListener.ts`) uses `fetchJsonWithTimeout` for polling Stellar Horizon events:

```typescript
// In production, pollOnce would use:
const url = `${config.horizonUrl}/contracts/${contractId}/events?startLedger=${ledger}`;
const response = await fetchJsonWithTimeout<HorizonEventsResponse>(url, {
  timeouts: {
    connectTimeoutMs: 5000,
    readTimeoutMs: 10000,
  }
});
```

Errors are caught and logged without stopping the polling loop.

### Risk Evaluation Service

Future integration with external risk providers should use the same timeout utilities:

```typescript
// src/services/riskService.ts
import { fetchJsonWithTimeout, HttpTimeoutError } from '../utils/fetchWithTimeout.js';

async function fetchRiskScore(walletAddress: string): Promise<RiskScore> {
  const url = `${RISK_PROVIDER_URL}/evaluate`;
  
  try {
    return await fetchJsonWithTimeout<RiskScore>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
      timeouts: {
        connectTimeoutMs: 3000,
        readTimeoutMs: 8000,
      },
    });
  } catch (error) {
    if (error instanceof HttpTimeoutError) {
      // Return cached score or default
      return getDefaultRiskScore(walletAddress);
    }
    throw error;
  }
}
```

## Recommended Timeout Values

### By Service Type

| Service | Connect Timeout | Read Timeout | Rationale |
|---------|----------------|--------------|-----------|
| Stellar Horizon | 5s | 10s | Public API, generally fast |
| Risk Providers | 3s | 8s | External service, may be slower |
| Internal APIs | 2s | 5s | Should be very fast |
| Blockchain RPCs | 5s | 15s | Can be slow during high load |

### By Environment

| Environment | Connect Timeout | Read Timeout |
|-------------|----------------|--------------|
| Development | 5s | 10s |
| Staging | 5s | 10s |
| Production | 5s | 15s |

## Monitoring and Observability

### Logging

All timeout errors are logged with structured context:

```
[HorizonListener] read timeout after 10000ms: https://horizon-testnet.stellar.org/contracts/...
[RiskService] HTTP request failed: HTTP 503 Service Unavailable (Network error)
```

### Metrics (Future)

Consider tracking these metrics:

- `http_request_duration_ms` - Histogram of request durations
- `http_timeout_total` - Counter of timeout errors by type (connect/read)
- `http_request_errors_total` - Counter of all HTTP errors by type

### Alerting (Future)

Alert on:

- High timeout rate (> 5% of requests)
- Sustained increase in request duration
- Specific service unavailability

## Security Considerations

### API Keys and Secrets

- Never log API keys or secrets in error messages
- The timeout utilities do not log request bodies or headers
- Ensure sensitive data is not included in URLs (use POST body instead)

### PII Protection

- Wallet addresses may be considered PII in some jurisdictions
- Error logs include URLs but not request/response bodies
- Consider redacting wallet addresses in production logs

### Stellar Private Keys

- Private keys should NEVER be sent in HTTP requests
- The backend only reads from Horizon (public data)
- Signing operations happen client-side or in secure enclaves

## Troubleshooting

### Frequent Timeouts

**Symptoms:** High rate of `HttpTimeoutError` in logs

**Possible causes:**
- Network latency to external services
- External service degradation
- Timeout values too aggressive

**Solutions:**
1. Check external service status pages
2. Increase timeout values if appropriate
3. Implement retry logic with exponential backoff
4. Consider caching responses

### Slow Requests

**Symptoms:** Requests completing just under timeout threshold

**Possible causes:**
- Large response payloads
- Database query performance
- Network congestion

**Solutions:**
1. Add pagination to reduce response size
2. Optimize database queries
3. Use CDN or caching layer
4. Increase read timeout if justified

### Connection Failures

**Symptoms:** `HttpRequestError` with network-related causes

**Possible causes:**
- DNS resolution failures
- Firewall blocking outbound connections
- Service endpoint down

**Solutions:**
1. Verify DNS configuration
2. Check firewall rules
3. Test connectivity with curl/wget
4. Verify service endpoint is correct

## Testing

### Unit Tests

The timeout utilities have comprehensive unit tests in `src/utils/__tests__/fetchWithTimeout.test.ts`:

```bash
npm test -- fetchWithTimeout
```

### Integration Tests

Test timeout behavior with real services:

```typescript
// Test with intentionally slow endpoint
const response = await fetchWithTimeout('https://httpbin.org/delay/5', {
  timeouts: { connectTimeoutMs: 1000, readTimeoutMs: 2000 }
});
// Should throw HttpTimeoutError
```

### Load Testing

The load testing harness (`scripts/load/`) includes timeout scenarios. See [docs/load-testing.md](./load-testing.md).

## Future Enhancements

- [ ] Retry logic with exponential backoff
- [ ] Circuit breaker pattern for failing services
- [ ] Request/response caching
- [ ] Metrics and observability integration
- [ ] Connection pooling and keep-alive
- [ ] Request prioritization and queuing

## References

- [Fetch API Specification](https://fetch.spec.whatwg.org/)
- [AbortController and AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [Stellar Horizon API](https://developers.stellar.org/api/horizon)
- [HTTP Timeout Best Practices](https://www.nginx.com/blog/avoiding-top-10-nginx-configuration-mistakes/#no-keepalives)
