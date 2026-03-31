# Manual Testing Guide - Cursor Pagination

This guide provides step-by-step instructions to manually test the cursor pagination feature.

## Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

The server should start on `http://localhost:3000`

## Test Scenarios

### Test 1: Run Automated Tests

First, verify all automated tests pass:

```bash
npm test
```

Expected output:
```
✓ src/repositories/memory/__tests__/InMemoryCreditLineRepository.test.ts (8 tests)
✓ src/services/__tests__/CreditLineService.test.ts (6 tests)
✓ src/routes/__tests__/credit.test.ts (7 tests)

Test Suites: 3 passed
Tests: 21+ passed
Coverage: 95%+
```

### Test 2: Cursor Pagination - First Page

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?cursor&limit=3"
```

**Expected Response:**
```json
{
  "creditLines": [
    {
      "id": "...",
      "walletAddress": "...",
      "creditLimit": "...",
      "availableCredit": "...",
      "interestRateBps": 500,
      "status": "active",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": {
    "limit": 3,
    "nextCursor": "base64EncodedString",
    "hasMore": true
  }
}
```

**Verify:**
- ✅ Response contains `creditLines` array
- ✅ `pagination.limit` equals 3
- ✅ `pagination.nextCursor` is a base64 string (if more data exists)
- ✅ `pagination.hasMore` is boolean
- ✅ No `total` or `offset` fields (cursor mode)

### Test 3: Cursor Pagination - Next Page

Copy the `nextCursor` value from Test 2 response.

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?cursor=<PASTE_NEXT_CURSOR>&limit=3"
```

**Expected Response:**
```json
{
  "creditLines": [...],
  "pagination": {
    "limit": 3,
    "nextCursor": "anotherBase64String",
    "hasMore": true
  }
}
```

**Verify:**
- ✅ Different items than first page (no duplicates)
- ✅ Items are ordered by `createdAt` then `id`
- ✅ `nextCursor` is different from previous page

### Test 4: Cursor Pagination - Last Page

Continue paginating until `hasMore` is false.

**Expected Response:**
```json
{
  "creditLines": [...],
  "pagination": {
    "limit": 3,
    "nextCursor": null,
    "hasMore": false
  }
}
```

**Verify:**
- ✅ `nextCursor` is `null`
- ✅ `hasMore` is `false`
- ✅ Items array may have fewer than limit items

### Test 5: Offset Pagination (Backward Compatibility)

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?offset=0&limit=5"
```

**Expected Response:**
```json
{
  "creditLines": [...],
  "pagination": {
    "total": 10,
    "offset": 0,
    "limit": 5
  }
}
```

**Verify:**
- ✅ Response contains `total` count
- ✅ Response contains `offset` and `limit`
- ✅ No `nextCursor` or `hasMore` fields (offset mode)
- ✅ Legacy pagination still works

### Test 6: Empty Dataset with Cursor

Clear all credit lines first (or use fresh database).

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?cursor&limit=10"
```

**Expected Response:**
```json
{
  "creditLines": [],
  "pagination": {
    "limit": 10,
    "nextCursor": null,
    "hasMore": false
  }
}
```

**Verify:**
- ✅ Empty array returned
- ✅ `nextCursor` is `null`
- ✅ `hasMore` is `false`

### Test 7: Invalid Limit - Zero

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?cursor&limit=0"
```

**Expected Response:**
```json
{
  "error": "Limit must be greater than 0"
}
```

**Status Code:** 400

**Verify:**
- ✅ Returns 400 Bad Request
- ✅ Error message is clear

### Test 8: Invalid Limit - Oversized

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?cursor&limit=101"
```

**Expected Response:**
```json
{
  "error": "Limit cannot exceed 100"
}
```

**Status Code:** 400

**Verify:**
- ✅ Returns 400 Bad Request
- ✅ Limit is capped at 100

### Test 9: Invalid Cursor

**Request:**
```bash
curl -X GET "http://localhost:3000/api/credit/lines?cursor=invalid-cursor&limit=10"
```

**Expected Response:**
```json
{
  "creditLines": [...],
  "pagination": {
    "limit": 10,
    "nextCursor": "...",
    "hasMore": true
  }
}
```

**Verify:**
- ✅ Returns 200 OK (graceful handling)
- ✅ Starts from beginning (like first page)
- ✅ No error thrown

### Test 10: Stable Ordering

Create multiple credit lines and paginate through all of them.

**Setup:**
```bash
# Create 10 credit lines
for i in {1..10}; do
  curl -X POST "http://localhost:3000/api/credit/lines" \
    -H "Content-Type: application/json" \
    -d "{\"walletAddress\":\"wallet$i\",\"requestedLimit\":\"1000.00\"}"
  sleep 0.1
done
```

**Test:**
```bash
# Fetch all pages with limit=3
curl "http://localhost:3000/api/credit/lines?cursor&limit=3" > page1.json
# Use nextCursor from page1.json
curl "http://localhost:3000/api/credit/lines?cursor=<CURSOR>&limit=3" > page2.json
# Continue for all pages...
```

**Verify:**
- ✅ All 10 items retrieved exactly once
- ✅ No duplicates across pages
- ✅ No missing items
- ✅ Items ordered by `createdAt` ascending

## Integration Test with Postman/Insomnia

### Collection Setup

1. **Create Environment Variables:**
   - `base_url`: `http://localhost:3000`
   - `cursor`: (will be set dynamically)

2. **Test 1: First Page**
   - Method: GET
   - URL: `{{base_url}}/api/credit/lines?cursor&limit=5`
   - Tests:
     ```javascript
     pm.test("Status is 200", () => pm.response.to.have.status(200));
     pm.test("Has creditLines array", () => pm.expect(pm.response.json().creditLines).to.be.an('array'));
     pm.test("Has pagination object", () => pm.expect(pm.response.json().pagination).to.be.an('object'));
     pm.test("Has nextCursor", () => pm.expect(pm.response.json().pagination.nextCursor).to.exist);
     
     // Save cursor for next request
     pm.environment.set("cursor", pm.response.json().pagination.nextCursor);
     ```

3. **Test 2: Next Page**
   - Method: GET
   - URL: `{{base_url}}/api/credit/lines?cursor={{cursor}}&limit=5`
   - Tests:
     ```javascript
     pm.test("Status is 200", () => pm.response.to.have.status(200));
     pm.test("Different items from first page", () => {
       // Compare IDs with previous page
     });
     ```

## Performance Testing

### Load Test with Apache Bench

```bash
# Test cursor pagination performance
ab -n 1000 -c 10 "http://localhost:3000/api/credit/lines?cursor&limit=50"

# Compare with offset pagination
ab -n 1000 -c 10 "http://localhost:3000/api/credit/lines?offset=0&limit=50"
```

**Expected:**
- Cursor pagination should have consistent response times
- Offset pagination may slow down with larger offsets

## Verification Checklist

After running all tests, verify:

- ✅ All automated tests pass (`npm test`)
- ✅ Cursor pagination returns correct format
- ✅ Next cursor works for pagination
- ✅ Last page has null cursor
- ✅ Offset pagination still works (backward compatible)
- ✅ Invalid cursors handled gracefully
- ✅ Limit validation works (0, negative, >100)
- ✅ Empty dataset handled correctly
- ✅ Stable ordering maintained
- ✅ No duplicate items across pages
- ✅ All items retrieved exactly once
- ✅ TypeScript compilation succeeds (`npm run build`)
- ✅ Linting passes (`npm run lint`)

## Troubleshooting

### Issue: "Cannot find module"
**Solution:** Run `npm install` to install dependencies

### Issue: "Port 3000 already in use"
**Solution:** Kill the process using port 3000 or change PORT in .env

### Issue: "Database connection error"
**Solution:** Ensure PostgreSQL is running or use in-memory repository (default for tests)

### Issue: Tests fail with "Execution policy" error
**Solution:** Run in bash or enable PowerShell scripts:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Success Criteria

The cursor pagination feature is working correctly if:

1. ✅ All 21+ automated tests pass
2. ✅ Manual API tests return expected responses
3. ✅ Backward compatibility maintained
4. ✅ No TypeScript errors
5. ✅ No linting errors
6. ✅ Coverage remains at 95%+
7. ✅ Documentation is clear and accurate

## Next Steps

After successful testing:

1. Create pull request from `develop` to `main`
2. Include test results in PR description
3. Request code review
4. Merge after approval
5. Deploy to staging environment
6. Run smoke tests in staging
7. Deploy to production
