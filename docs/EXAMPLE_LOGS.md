# Example Log Output

This document shows real examples of the structured logging output from creditra-backend.

## Successful Request

```bash
curl http://localhost:3000/api/credit/lines
```

Log output:

```json
{"timestamp":"2026-02-26T10:30:45.123Z","level":"info","message":"Incoming request","context":{"correlationId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","method":"GET","path":"/api/credit/lines","query":{},"userAgent":"curl/7.88.1"}}
{"timestamp":"2026-02-26T10:30:45.168Z","level":"info","message":"Request completed","context":{"correlationId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","method":"GET","path":"/api/credit/lines","statusCode":200,"durationMs":45}}
```

## Request with Client-Provided Correlation ID

```bash
curl -H "x-correlation-id: my-trace-123" http://localhost:3000/api/risk/evaluate \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"GXXX..."}'
```

Log output:

```json
{"timestamp":"2026-02-26T10:31:12.456Z","level":"info","message":"Incoming request","context":{"correlationId":"my-trace-123","method":"POST","path":"/api/risk/evaluate","query":{},"userAgent":"curl/7.88.1"}}
{"timestamp":"2026-02-26T10:31:12.501Z","level":"info","message":"Request completed","context":{"correlationId":"my-trace-123","method":"POST","path":"/api/risk/evaluate","statusCode":200,"durationMs":45}}
```

## Error Request (404)

```bash
curl http://localhost:3000/api/credit/lines/999
```

Log output:

```json
{"timestamp":"2026-02-26T10:32:05.789Z","level":"info","message":"Incoming request","context":{"correlationId":"b2c3d4e5-f6a7-8901-bcde-f12345678901","method":"GET","path":"/api/credit/lines/999","query":{},"userAgent":"curl/7.88.1"}}
{"timestamp":"2026-02-26T10:32:05.812Z","level":"warn","message":"Request completed","context":{"correlationId":"b2c3d4e5-f6a7-8901-bcde-f12345678901","method":"GET","path":"/api/credit/lines/999","statusCode":404,"durationMs":23}}
```

## Server Error (500)

```bash
curl http://localhost:3000/api/broken-endpoint
```

Log output:

```json
{"timestamp":"2026-02-26T10:33:15.234Z","level":"info","message":"Incoming request","context":{"correlationId":"c3d4e5f6-a7b8-9012-cdef-123456789012","method":"GET","path":"/api/broken-endpoint","query":{},"userAgent":"curl/7.88.1"}}
{"timestamp":"2026-02-26T10:33:15.267Z","level":"error","message":"Request error","context":{"correlationId":"c3d4e5f6-a7b8-9012-cdef-123456789012","method":"GET","path":"/api/broken-endpoint"},"error":{"name":"TypeError","message":"Cannot read property 'foo' of undefined","stack":"TypeError: Cannot read property 'foo' of undefined\n    at /app/dist/routes/broken.js:12:34\n    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)"}}
{"timestamp":"2026-02-26T10:33:15.270Z","level":"warn","message":"Request completed","context":{"correlationId":"c3d4e5f6-a7b8-9012-cdef-123456789012","method":"GET","path":"/api/broken-endpoint","statusCode":500,"durationMs":36}}
```

## Sensitive Data Redaction

When logging context with sensitive fields:

```typescript
logger.info('User authenticated', {
  correlationId: req.correlationId,
  userId: '123',
  walletAddress: 'GXXX...',
  privateKey: 'SXXX...', // Will be redacted
  apiKey: 'sk_live_xxx', // Will be redacted
});
```

Log output:

```json
{"timestamp":"2026-02-26T10:34:22.567Z","level":"info","message":"User authenticated","context":{"correlationId":"d4e5f6a7-b8c9-0123-def1-234567890123","userId":"123","walletAddress":"GXXX...","privateKey":"[REDACTED]","apiKey":"[REDACTED]"}}
```

## Application Startup

```bash
npm start
```

Log output:

```json
{"timestamp":"2026-02-26T10:00:00.000Z","level":"info","message":"Server started","context":{"port":3000,"service":"creditra-backend"}}
```

## Parsing and Analyzing Logs

### Filter by correlation ID

```bash
cat logs.json | jq 'select(.context.correlationId == "a1b2c3d4-e5f6-7890-abcd-ef1234567890")'
```

### Find slow requests (>100ms)

```bash
cat logs.json | jq 'select(.context.durationMs > 100)'
```

### Count requests by status code

```bash
cat logs.json | jq -r 'select(.context.statusCode) | .context.statusCode' | sort | uniq -c
```

Output:
```
  245 200
   12 404
    3 500
```

### Get average response time

```bash
cat logs.json | jq -s '[.[] | select(.context.durationMs) | .context.durationMs] | add/length'
```

Output:
```
42.5
```

### Find all errors

```bash
cat logs.json | jq 'select(.level == "error")'
```

### Group errors by path

```bash
cat logs.json | jq -r 'select(.level == "error") | .context.path' | sort | uniq -c
```

Output:
```
   2 /api/credit/lines/999
   1 /api/broken-endpoint
```
