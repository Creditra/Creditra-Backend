# Strict JSON Schema Validation (Request + Response)

Zod schemas under [`src/schemas/`](../src/schemas/) are the **single source of truth** for public API request and response contracts. OpenAPI (`src/openapi.yaml`) and human docs should track these schemas; when they disagree, fix OpenAPI.

## Goals

1. Every public route validates inputs (`body` / `query` / `params`) before the handler runs.
2. Invalid input returns a **stable** envelope — no stack traces, SQL, or internal exception text.
3. Response shapes can be asserted in tests (and optionally at runtime) to catch contract drift early.

## Request validation

Middleware factories in [`src/middleware/validate.ts`](../src/middleware/validate.ts):

| Factory | Applies to | On failure |
|---|---|---|
| `validateBody(schema)` | JSON body | `400` + details |
| `validateQuery(schema)` | Query string | `400` + details |
| `validateParams(schema)` | Path params | `400` + details |

### Error envelope

```json
{
  "data": null,
  "error": "Validation failed",
  "details": [
    { "field": "walletAddress", "message": "walletAddress must be a valid Stellar address" }
  ]
}
```

Rules:

- `error` is always the literal `"Validation failed"` for schema failures.
- `details[].field` is a dotted path (`user.email`) or `"(root)"`.
- Unknown keys are rejected via `.strict()` on request schemas (`additionalProperties: false` in OpenAPI).
- Stellar addresses use `^G[A-Z2-7]{55}$` via [`stellarAddress.ts`](../src/utils/stellarAddress.ts).

### Schema modules

| Module | Contents |
|---|---|
| `common.schema.ts` | Shared field primitives (wallet address) |
| `credit.schema.ts` | Create / update / draw / repay / list / transactions |
| `risk.schema.ts` | Evaluate body, history query |
| `params.schema.ts` | `:id`, `:walletAddress` path params |
| `admin.schema.ts` | API keys, maintenance, bulk ingest |
| `response.schema.ts` | Output contracts + envelope helpers |

## Response validation

### Runtime (opt-in)

```bash
ENABLE_RESPONSE_VALIDATION=true npm start
# or
RESPONSE_SCHEMA_VALIDATION=true npm test
```

When enabled, `validateResponse(schema)` wraps `res.json` and:

- Allows the response through if it matches the schema.
- On mismatch, logs field-level details server-side and returns:

```json
{ "data": null, "error": "Response contract violation" }
```

HTTP status is forced to `500`. Clients never receive Zod issue text for response failures.

Default is **off** so production stays fail-open on response shape while request validation remains mandatory.

### Integration tests (always on for assertions)

Use `assertMatchesSchema(schema, body, label)` from the validate middleware:

```ts
import { assertMatchesSchema } from '../src/middleware/validate.js';
import { envelopedRiskResultSchema } from '../src/schemas/index.js';

const res = await request(app).post('/api/risk/evaluate').send({ walletAddress });
assertMatchesSchema(envelopedRiskResultSchema, res.body, 'POST /api/risk/evaluate');
```

See [`tests/response-contract.test.ts`](../tests/response-contract.test.ts).

## Route coverage checklist

| Route | Request schema | Response schema (test / optional runtime) |
|---|---|---|
| `GET /health` | — | `envelopedHealthSchema` |
| `GET /api/credit/lines` | `creditLinesQuerySchema` | list / cursor schemas |
| `GET /api/credit/lines/:id` | `idParamSchema` | `envelopedCreditLineSchema` |
| `POST /api/credit/lines` | `createCreditLineSchema` | `envelopedCreditLineSchema` |
| `PUT /api/credit/lines/:id` | `idParamSchema` + `updateCreditLineSchema` | `envelopedCreditLineSchema` |
| `DELETE /api/credit/lines/:id` | `idParamSchema` | 204 empty |
| `GET /api/credit/wallet/:walletAddress/lines` | `walletAddressParamSchema` | `envelopedWalletCreditLinesSchema` |
| `GET /api/credit/lines/:id/transactions` | id + `transactionHistoryQuerySchema` | `envelopedTransactionHistorySchema` |
| `POST …/draw` / `…/repay` | id + draw/repay body | `drawRepayResultSchema` |
| `POST /api/risk/evaluate` | `riskEvaluateSchema` | `envelopedRiskResultSchema` |
| `GET /api/risk/evaluations/:id` | `idParamSchema` | `envelopedRiskEvaluationSchema` |
| `GET /api/risk/wallet/...` | wallet (+ history query) | evaluation / history envelopes |
| `POST /api/admin/maintenance` | `maintenanceToggleSchema` | status JSON |
| `POST /api/admin/api-keys` | `issueApiKeySchema` | key issue envelope |
| `POST /api/credit/lines/bulk` | bulk body + query | multi-status payload |
| Reconciliation admin | auth only | enveloped trigger / status |

## OpenAPI

- Spec: [`src/openapi.yaml`](../src/openapi.yaml) (served at `/docs` and `/docs.json`).
- Validation errors document `ValidationErrorResponse` with `details[]`.
- Keep `additionalProperties: false` on request bodies in sync with Zod `.strict()`.
- Validate YAML structure: `npm run validate:spec`.

## Adding a new endpoint

1. Add request Zod schema(s) under `src/schemas/` and export from `index.ts`.
2. Wire `validateBody` / `validateQuery` / `validateParams` on the route **before** the handler.
3. Add a response schema; attach `validateResponse(...)` if the success path is stable.
4. Extend unit tests in `tests/schemas/` and a contract assertion in `tests/response-contract.test.ts` (or route tests).
5. Update `src/openapi.yaml` + `docs/API.md`.

## Security notes

- Request validation runs after auth middleware where routes are protected — unauthenticated clients still get `401`/`403` without revealing schema details of protected bodies when auth fails first.
- 5xx paths continue to use `fail()` which strips non-string Error objects (see [`docs/error-envelope.md`](./error-envelope.md)).
- Response contract violations never echo Zod internals to the client.

## Related

- [`docs/error-envelope.md`](./error-envelope.md) — `{ data, error }` helpers
- [`docs/SECURITY.md`](./SECURITY.md) § Input Validation Policy
- [`docs/schema-validation.md`](./schema-validation.md) — **database** boot-time schema checks (different concern)
- [`docs/TESTING.md`](./TESTING.md) — test pyramid
