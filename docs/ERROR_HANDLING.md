# Error Handling – Creditra Backend

## Overview

Creditra Backend uses a **centralised error-handling middleware** to guarantee
every error response follows the same JSON envelope, regardless of where the
error originates.

---

## Error Response Format

All error responses are returned as JSON with the following shape:

```jsonc
{
  "error": "Human-readable description",  // always present
  "code": "ERROR_CODE",                    // always present – see table below
  "details": { /* ... */ }                 // optional – extra context
}
```

| Field     | Type     | Required | Description                                      |
| --------- | -------- | -------- | ------------------------------------------------ |
| `error`   | `string` | ✅        | Short, human-readable error message               |
| `code`    | `string` | ✅        | Machine-readable error category (see below)       |
| `details` | `any`    | ❌        | Additional context (field names, resource IDs, …) |

---

## Error Codes

| Code                   | HTTP Status | When to use                                       |
| ---------------------- | ----------- | ------------------------------------------------- |
| `VALIDATION_ERROR`     | 400         | Missing / malformed request fields                 |
| `AUTHENTICATION_ERROR` | 401         | Missing or invalid authentication credentials      |
| `AUTHORIZATION_ERROR`  | 403         | Authenticated but not authorised for the resource  |
| `NOT_FOUND`            | 404         | Requested resource or route does not exist         |
| `INTERNAL_ERROR`       | 500         | Unexpected server errors                           |

---

## Examples

### 400 – Validation Error

```json
{
  "error": "walletAddress is required",
  "code": "VALIDATION_ERROR",
  "details": { "field": "walletAddress" }
}
```

### 401 – Authentication Error

```json
{
  "error": "Authentication required",
  "code": "AUTHENTICATION_ERROR"
}
```

### 403 – Authorization Error

```json
{
  "error": "Admin only",
  "code": "AUTHORIZATION_ERROR"
}
```

### 404 – Not Found

```json
{
  "error": "Credit line with id \"42\" not found",
  "code": "NOT_FOUND",
  "details": { "resource": "Credit line", "id": "42" }
}
```

### 404 – Route Not Found (catch-all)

```json
{
  "error": "Route GET /api/nonexistent not found",
  "code": "NOT_FOUND"
}
```

### 500 – Internal Error

```json
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR"
}
```

> **Note:** In non-production environments, 500 responses may include a `details.stack` property with the stack trace for debugging. This is **never** exposed in production.

---

## Usage (for backend developers)

### Throwing errors in route handlers

```ts
import { validationError, notFoundError, authenticationError } from '../errors/index.js';

// Option 1 – pass to next()
router.get('/resource/:id', (req, _res, next) => {
  const item = db.get(req.params.id);
  if (!item) return next(notFoundError('Resource', req.params.id));
  // ...
});

// Option 2 – throw (if using express-async-errors or similar)
router.post('/resource', (req, _res, next) => {
  if (!req.body.name) {
    return next(validationError('name is required', { field: 'name' }));
  }
  // ...
});
```

### Available helpers

| Helper                | Creates                                     |
| --------------------- | ------------------------------------------- |
| `validationError(msg, details?)`    | 400 VALIDATION_ERROR            |
| `notFoundError(resource, id?)`      | 404 NOT_FOUND                   |
| `authenticationError(msg?)`         | 401 AUTHENTICATION_ERROR        |
| `authorizationError(msg?)`          | 403 AUTHORIZATION_ERROR         |
| `internalError(msg?, details?)`     | 500 INTERNAL_ERROR              |

### Direct AppError construction

```ts
import { AppError, ErrorCode } from '../errors/index.js';

throw new AppError('Custom message', ErrorCode.VALIDATION_ERROR, { extra: 'data' });
```

---

## Architecture

```
src/
├── errors/
│   ├── AppError.ts      ← Error class + factory helpers
│   └── index.ts          ← Barrel exports
├── middleware/
│   └── errorHandler.ts   ← Express error-handling middleware + 404 catch-all
└── index.ts               ← Wiring: notFoundHandler → errorHandler (after all routes)
```

The middleware is registered in `src/index.ts` **after** all route handlers:

```ts
app.use(notFoundHandler); // unmatched routes → 404
app.use(errorHandler);    // serialise all errors → JSON
```
