# OpenAPI / Swagger Documentation

## Viewing the docs

Start the dev server and open:

```
http://localhost:3000/docs        ← Swagger UI (interactive)
http://localhost:3000/docs.json   ← Raw JSON spec (for client generation)
```

## Spec location

```
src/openapi.yaml
```

The spec is loaded at runtime from that file, so edits are reflected immediately
on the next server restart — no build step needed.

## Adding a new route (checklist)

1. Implement the route handler in `src/routes/`.
2. Open `src/openapi.yaml` and add the path under `paths:`.
3. Add or reuse component schemas under `components/schemas:`.
4. Run `npm run validate:openapi` - must exit 0.
5. Add at least one test in `src/tests/api.test.ts` for the new endpoint.
6. Run `npm test` — all tests must pass.

## Validating the spec and route drift

```bash
npm run validate:openapi
```

This checks that `src/openapi.yaml` is well-formed YAML and that every mounted
Express route operation is represented in the OpenAPI paths. The route drift
check intentionally covers only routers mounted in `src/index.ts`; if a new
router is mounted there, add it to `scripts/check-openapi-drift.mjs`.

For deeper linting
(spec correctness, unused schemas) install `@stoplight/spectral-cli`:

```bash
npx @stoplight/spectral-cli lint src/openapi.yaml
```

## Generating a typed client

```bash
npx openapi-typescript src/openapi.yaml -o src/generated/api.d.ts
```

Re-run this whenever `openapi.yaml` changes.

## CI integration

CI runs the combined validation through `npm run validate:openapi`:

```yaml
- run: npm run validate:openapi
- run: npm test
```
