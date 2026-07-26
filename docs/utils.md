# Utilities (`src/utils/`)

This directory holds small, dependency-free helpers that are reused across
the route, service, and repository layers. Anything placed here MUST:

- Be **pure** (no I/O, no environment lookup) or wrap an explicit dependency.
- Have **no imports from `src/services/`, `src/routes/`, or `src/repositories/`**
  to avoid creating dependency cycles.
- Be **covered by unit tests** in `src/utils/__tests__/`.

## Module index

| Module             | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `constants.ts`     | Pagination and body-size defaults shared by API endpoints |
| `cursorPagination.ts` | Opaque cursor encode/decode, page builder, limit clamp |
| `fetchWithTimeout` | HTTP client with structured timeout and request errors    |
| `httpStatus.ts`    | Named HTTP status code constants (incl. `304`)            |
| `logger.ts`        | Process-wide pino logger configuration                    |
| `logRedact.ts`     | Helpers for redacting sensitive values from log lines     |
| `numbers.ts`       | `clamp`, `isFiniteInteger`, `parsePositiveInt`            |
| `response.ts`      | `ok` / `fail` for the standard `ApiResponse` envelope     |
| `stellarAddress.ts`| Validation/redaction helpers for Stellar addresses        |
| `strings.ts`       | `isNonEmptyString`, `truncate`, `capitalize`              |
| `time.ts`          | Duration constants and `sleep` / `nowSeconds` helpers     |

## `logRedact.ts` — tested behaviors

The redactor is the last line of defense before secrets reach stdout (used by
Horizon listener and webhook logging). Coverage lives in
[`src/__test__/logRedact.test.ts`](../src/__test__/logRedact.test.ts).

| API | Behavior under test |
| --- | --- |
| `redactLogString` | Truncates Stellar **G…** public keys to `6…4`; replaces **S…** secret seeds, **M…** muxed accounts, and email addresses with fixed tokens. |
| `redactLogValue` | Walks plain objects and arrays (including deep nests); redacts `Error.message` / `Error.stack`; breaks cycles with `"[Circular]"` via a `WeakSet`; passes numbers, booleans, `null`, and `undefined` through unchanged. |
| `redactLogArgs` | Maps each arg through `redactLogValue`; returns a new array (does not mutate the input). |
| `isLogRedactionDebugEnabled` | Truthy only for env values `"1"` and `"true"` (case-insensitive, trimmed). When enabled, all redact helpers return inputs **verbatim** (same reference for args/objects). |

`LOG_REDACTION_DEBUG` must never be enabled in production. Tests that toggle the
flag restore `process.env` in `afterEach`.

## Adding a new utility

1. Create the module in `src/utils/<name>.ts` with full JSDoc.
2. Add unit tests in `src/utils/__tests__/<name>.test.ts`.
3. Update the table above.
4. Avoid introducing transitive runtime dependencies; helpers should be
   importable from any layer without side effects.
