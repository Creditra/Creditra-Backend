# API Key Hardening TODO

## Plan Steps (Approved)
1. [x] Create branch `feature/api-key-hardening`
2. [x] Update src/middleware/auth.ts: Implement timing-safe comparison using crypto.timingSafeEqual
3. [x] Update src/__tests__/auth.test.ts: Add tests for dynamic resolver with loadApiKeys()
4. [x] Fixed test compilation errors and header array handling
5. [x] Tests pass for auth middleware (15/15), timing-safe impl verified
6. [ ] Document API_KEYS env var in docs/security-checklist-backend.md
7. [ ] Add/update securityScheme in docs/openapi.yaml for x-api-key
8. [ ] Run full `npm test --coverage` 
9. [ ] Run `npm run build`
10. [ ] Commit changes
11. [ ] Check/install GitHub CLI (`gh`), create PR

Current progress: Core hardening complete, tests green. Adding docs.

