# Quick Start: Structured Logging

Get started with structured logging and correlation IDs in 5 minutes.

## Installation

```bash
npm install
```

## Run Tests

```bash
# Run all tests
npm test

# Run with coverage (100% on logging utilities)
npm run test:coverage
```

## Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## Make a Request

```bash
# Simple request
curl http://localhost:3000/api/credit/lines

# With your own correlation ID
curl -H "x-correlation-id: my-trace-123" \
  http://localhost:3000/api/credit/lines
```

## View Logs

Logs are output to stdout as JSON:

```json
{"timestamp":"2026-02-26T10:30:45.123Z","level":"info","message":"Incoming request","context":{"correlationId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","method":"GET","path":"/api/credit/lines","query":{},"userAgent":"curl/7.88.1"}}
{"timestamp":"2026-02-26T10:30:45.168Z","level":"info","message":"Request completed","context":{"correlationId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","method":"GET","path":"/api/credit/lines","statusCode":200,"durationMs":45}}
```

## Use in Your Code

```typescript
import { logger } from './logger.js';

// In a route handler
app.get('/api/example', (req, res) => {
  logger.info('Processing request', {
    correlationId: req.correlationId,
    userId: '123',
  });

  try {
    // Your logic here
    res.json({ success: true });
  } catch (error) {
    logger.error('Request failed', {
      correlationId: req.correlationId,
    }, error as Error);
    throw error; // Will be caught by error handler
  }
});
```

## Configure Log Level

```bash
# Show all logs including debug
LOG_LEVEL=debug npm run dev

# Only warnings and errors
LOG_LEVEL=warn npm start

# Only errors
LOG_LEVEL=error npm start
```

## Trace a Request

1. Make a request and note the correlation ID from the response header:

```bash
curl -v http://localhost:3000/api/credit/lines
# Look for: x-correlation-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

2. Search logs for that correlation ID:

```bash
# If logs are in a file
grep "a1b2c3d4-e5f6-7890-abcd-ef1234567890" logs.json

# Or pipe through jq for pretty output
cat logs.json | jq 'select(.context.correlationId == "a1b2c3d4-e5f6-7890-abcd-ef1234567890")'
```

## Next Steps

- Read [LOGGING.md](./LOGGING.md) for comprehensive documentation
- See [EXAMPLE_LOGS.md](./EXAMPLE_LOGS.md) for more log examples
- Check [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for technical details

## Key Features

✅ Automatic correlation IDs for every request  
✅ JSON structured logs for easy parsing  
✅ Sensitive data redaction (private keys, secrets)  
✅ Request timing and status code logging  
✅ Error tracking with stack traces  
✅ 100% test coverage  
✅ Production-ready
