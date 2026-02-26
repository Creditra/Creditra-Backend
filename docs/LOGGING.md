# Structured Logging and Correlation IDs

This document describes the structured logging implementation and correlation ID system for creditra-backend.

## Overview

The logging system provides:

- **Structured JSON logs** for easy parsing and analysis
- **Correlation IDs** for end-to-end request tracing
- **Automatic sensitive data redaction** to prevent leaking secrets
- **Multiple log levels** (DEBUG, INFO, WARN, ERROR)
- **Request/response logging** with timing information

## Architecture

### Components

1. **Logger** (`src/logger.ts`)
   - Core logging utility with JSON output
   - Automatic sensitive data sanitization
   - Configurable log levels

2. **Correlation Middleware** (`src/middleware/correlation.ts`)
   - Generates or extracts correlation IDs
   - Attaches IDs to requests and responses

3. **Request Logging Middleware** (`src/middleware/logging.ts`)
   - Logs incoming requests
   - Logs response completion with timing

4. **Error Handler Middleware** (`src/middleware/errorHandler.ts`)
   - Catches and logs errors
   - Returns safe error responses

## Usage

### Basic Logging

```typescript
import { logger } from './logger.js';

// Info level
logger.info('User action completed', {
  correlationId: req.correlationId,
  userId: '123',
  action: 'create_credit_line',
});

// Error level
logger.error('Database connection failed', {
  correlationId: req.correlationId,
  database: 'postgres',
}, error);

// Debug level (only in development)
logger.debug('Cache hit', {
  correlationId: req.correlationId,
  key: 'user:123',
});
```

### Log Levels

Set the log level via environment variable:

```bash
LOG_LEVEL=debug npm run dev    # Show all logs
LOG_LEVEL=info npm run dev     # Default: info and above
LOG_LEVEL=warn npm run dev     # Only warnings and errors
LOG_LEVEL=error npm run dev    # Only errors
```

### Correlation IDs

Correlation IDs are automatically generated for each request. Clients can provide their own:

```bash
curl -H "x-correlation-id: my-trace-id-123" http://localhost:3000/api/credit/lines
```

The correlation ID is:
- Attached to `req.correlationId` for use in handlers
- Returned in the `x-correlation-id` response header
- Included in all log entries for that request

### Log Format

All logs are output as JSON:

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

Error logs include error details:

```json
{
  "timestamp": "2026-02-26T10:31:12.456Z",
  "level": "error",
  "message": "Request error",
  "context": {
    "correlationId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "method": "GET",
    "path": "/api/credit/lines/999"
  },
  "error": {
    "name": "NotFoundError",
    "message": "Credit line not found",
    "stack": "NotFoundError: Credit line not found\n    at ..."
  }
}
```

## Security

### Sensitive Data Redaction

The logger automatically redacts sensitive fields matching these patterns:

- `privateKey`, `private_key`, `privatekey`
- `secret`, `apiSecret`, `clientSecret`
- `password`, `userPassword`, `pass`
- `token`, `authToken`, `accessToken`
- `apiKey`, `api_key`
- `auth`, `authorization`

Example:

```typescript
logger.info('User authenticated', {
  correlationId: req.correlationId,
  userId: '123',
  privateKey: 'GXXX...', // Will be logged as [REDACTED]
  apiKey: 'sk_live_xxx', // Will be logged as [REDACTED]
});
```

### Production vs Development

In production (`NODE_ENV=production`):
- Error details are hidden from API responses
- Only generic "Internal server error" messages are returned
- Full error details are still logged for debugging

In development:
- Error messages and stack traces are included in responses
- More verbose logging available

## Request Tracing

To trace a request end-to-end:

1. Make a request (optionally with your own correlation ID)
2. Note the correlation ID in the response header
3. Search logs for that correlation ID

Example:

```bash
# Make request
curl -v http://localhost:3000/api/risk/evaluate \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"GXXX..."}'

# Response includes:
# x-correlation-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Search logs
grep "a1b2c3d4-e5f6-7890-abcd-ef1234567890" logs.json
```

## Log Analysis

Since logs are JSON, they can be easily parsed and analyzed:

```bash
# Filter by correlation ID
cat logs.json | jq 'select(.context.correlationId == "abc-123")'

# Find slow requests (>1000ms)
cat logs.json | jq 'select(.context.durationMs > 1000)'

# Count errors by path
cat logs.json | jq -r 'select(.level == "error") | .context.path' | sort | uniq -c

# Get average response time
cat logs.json | jq -s '[.[] | select(.context.durationMs) | .context.durationMs] | add/length'
```

## Testing

The logging system has comprehensive test coverage (>95%):

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Integration with Background Jobs

For background jobs or async operations, create a correlation ID and pass it through:

```typescript
import { randomUUID } from 'crypto';
import { logger } from './logger.js';

async function processJob(jobData: any) {
  const correlationId = randomUUID();
  
  logger.info('Job started', {
    correlationId,
    jobType: 'interest_accrual',
    jobId: jobData.id,
  });

  try {
    // Process job...
    logger.info('Job completed', {
      correlationId,
      jobId: jobData.id,
    });
  } catch (error) {
    logger.error('Job failed', {
      correlationId,
      jobId: jobData.id,
    }, error as Error);
  }
}
```

## Best Practices

1. **Always include correlation ID** in log context
2. **Use appropriate log levels**:
   - DEBUG: Detailed diagnostic information
   - INFO: General informational messages
   - WARN: Warning messages (4xx responses, deprecated features)
   - ERROR: Error messages (5xx responses, exceptions)
3. **Don't log sensitive data** (the system will redact it, but avoid it anyway)
4. **Include relevant context** (user IDs, resource IDs, operation types)
5. **Log at boundaries** (API entry/exit, external service calls, database operations)
6. **Keep messages concise** but descriptive

## Future Enhancements

Potential improvements:

- Log aggregation service integration (e.g., ELK, Datadog, CloudWatch)
- Structured error types with error codes
- Performance metrics and APM integration
- Log sampling for high-traffic endpoints
- Distributed tracing with OpenTelemetry
