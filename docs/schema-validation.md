# Schema Validation

This document describes the database schema validation system for ensuring the Creditra backend has all required tables, columns, and indexes before serving traffic.

## Overview

The schema validation CLI (`npm run db:validate`) performs comprehensive checks on the PostgreSQL database to ensure:

1. All required tables exist (borrowers, credit_lines, risk_evaluations, transactions, events)
2. Critical columns exist in each table
3. Performance-critical indexes are present

This is designed for use as a Kubernetes init container or pre-flight check before starting the application.

## Usage

### Basic Validation

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/creditra npm run db:validate
```

### With Environment Variables

```bash
# Skip column validation (faster, less strict)
SKIP_COLUMN_CHECK=true npm run db:validate

# Skip index validation
SKIP_INDEX_CHECK=true npm run db:validate

# Skip both (tables only)
SKIP_COLUMN_CHECK=true SKIP_INDEX_CHECK=true npm run db:validate
```

### Exit Codes

- `0` - Validation passed, database is ready
- `1` - Validation failed or connection error

## Validation Checks

### 1. Table Existence

Verifies all core tables exist:

- `borrowers` - Borrower identities and wallet addresses
- `credit_lines` - Credit facilities per borrower
- `risk_evaluations` - Historical risk scores and terms
- `transactions` - Draws and repayments
- `events` - Immutable domain events

### 2. Required Columns

Checks that critical columns exist in each table:

**borrowers:**
- `id`, `wallet_address`, `created_at`

**credit_lines:**
- `id`, `borrower_id`, `credit_limit`, `currency`, `status`, `created_at`

**risk_evaluations:**
- `id`, `borrower_id`, `risk_score`, `suggested_limit`, `interest_rate_bps`, `evaluated_at`

**transactions:**
- `id`, `credit_line_id`, `type`, `amount`, `currency`, `created_at`

**events:**
- `id`, `event_type`, `created_at`

### 3. Critical Indexes

Verifies performance-critical indexes exist:

**borrowers:**
- `borrowers_wallet_address_key` - Unique constraint on wallet addresses

**credit_lines:**
- `credit_lines_borrower_id_idx` - Foreign key lookup
- `credit_lines_status_idx` - Status filtering

**risk_evaluations:**
- `risk_evaluations_borrower_id_idx` - Foreign key lookup

**transactions:**
- `transactions_credit_line_id_idx` - Foreign key lookup

**events:**
- `events_idempotency_key_key` - Deduplication

## Kubernetes Integration

### Init Container

Use as an init container to ensure database is ready before starting the main application:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: creditra-backend
spec:
  template:
    spec:
      initContainers:
        - name: db-validate
          image: creditra-backend:latest
          command: ["npm", "run", "db:validate"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: creditra-secrets
                  key: database-url
      containers:
        - name: api
          image: creditra-backend:latest
          # ... main container config
```

### Readiness Probe

For ongoing health checks, use a readiness probe:

```yaml
readinessProbe:
  exec:
    command: ["npm", "run", "db:validate"]
  initialDelaySeconds: 5
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 3
```

## Programmatic Usage

### In Application Code

```typescript
import { getConnection } from './db/client.js';
import { validateSchema, SchemaValidationError } from './db/validate-schema.js';

async function startServer() {
  const client = getConnection();
  
  try {
    await client.connect();
    await validateSchema(client);
    console.log('Database schema validated');
    
    // Start Express server
    app.listen(3000);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      console.error('Schema validation failed:', error.message);
      console.error('Details:', error.details);
      process.exit(1);
    }
    throw error;
  } finally {
    await client.end();
  }
}
```

### Custom Validation

```typescript
import { missingTables, missingColumns, missingIndexes } from './db/validate-schema.js';

// Check specific tables
const missing = await missingTables(client, ['borrowers', 'credit_lines']);
if (missing.length > 0) {
  console.error('Missing tables:', missing);
}

// Check specific columns
const missingCols = await missingColumns(client, 'borrowers', ['id', 'wallet_address']);
if (missingCols.length > 0) {
  console.error('Missing columns:', missingCols);
}

// Check specific indexes
const missingIdxs = await missingIndexes(client, 'borrowers', ['borrowers_wallet_address_key']);
if (missingIdxs.length > 0) {
  console.error('Missing indexes:', missingIdxs);
}
```

## Error Output

### Missing Tables

```
❌ Schema validation failed

ERROR: Missing tables: credit_lines, transactions

Missing tables:
  - credit_lines
  - transactions

Action required:
  1. Ensure migrations have been applied: npm run db:migrate
  2. Check migration files in migrations/ directory
  3. Verify database schema matches expected structure
```

### Missing Columns

```
❌ Schema validation failed

ERROR: Missing required columns: borrowers.wallet_address, credit_lines.status

Missing columns:
  - borrowers.wallet_address
  - credit_lines.status

Action required:
  1. Ensure migrations have been applied: npm run db:migrate
  2. Check migration files in migrations/ directory
  3. Verify database schema matches expected structure
```

### Missing Indexes

```
❌ Schema validation failed

ERROR: Missing critical indexes: borrowers.borrowers_wallet_address_key

Missing indexes:
  - borrowers.borrowers_wallet_address_key

Action required:
  1. Ensure migrations have been applied: npm run db:migrate
  2. Check migration files in migrations/ directory
  3. Verify database schema matches expected structure
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Deploy

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Validate database schema
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npm run db:validate

      - name: Deploy
        run: ./deploy.sh
```

### GitLab CI

```yaml
validate-schema:
  stage: test
  script:
    - npm ci
    - npm run build
    - npm run db:validate
  variables:
    DATABASE_URL: $DATABASE_URL
  only:
    - main
    - staging
```

## Troubleshooting

### Connection Errors

**Error:** `Cannot connect to database`

**Solutions:**
1. Verify `DATABASE_URL` is set correctly
2. Check database server is running
3. Verify network connectivity
4. Check firewall rules

### Migration Not Applied

**Error:** `Missing tables: borrowers, credit_lines, ...`

**Solutions:**
1. Run migrations: `npm run db:migrate`
2. Check migration files exist in `migrations/` directory
3. Verify `schema_migrations` table exists

### Column Missing After Migration

**Error:** `Missing required columns: borrowers.wallet_address`

**Solutions:**
1. Check migration file includes the column definition
2. Verify migration was applied: `SELECT * FROM schema_migrations`
3. Manually inspect table: `\d borrowers` (psql)

### Index Missing

**Error:** `Missing critical indexes: borrowers_wallet_address_key`

**Solutions:**
1. Check migration file includes the index creation
2. Manually create index if needed:
   ```sql
   CREATE UNIQUE INDEX borrowers_wallet_address_key ON borrowers (wallet_address);
   ```

## Performance Considerations

### Validation Speed

- Table checks: ~10ms per table
- Column checks: ~20ms per table
- Index checks: ~20ms per table
- Total: ~250ms for full validation

### Optimization

For faster validation in development:

```bash
# Skip expensive checks
SKIP_COLUMN_CHECK=true SKIP_INDEX_CHECK=true npm run db:validate
```

For production, always run full validation.

## Security Considerations

### Database Credentials

- Never commit `DATABASE_URL` to version control
- Use environment variables or secrets management
- Rotate credentials regularly

### PII and Sensitive Data

- Validation does not read table data, only schema metadata
- No PII is logged or exposed
- Safe to run in production

### Stellar Keys

- Schema validation does not interact with Stellar network
- No private keys are used or required
- Only database schema is checked

## Testing

### Unit Tests

```bash
npm test -- validate-schema
```

Coverage: 95%+ on all validation functions

### Integration Tests

Test against real PostgreSQL:

```bash
# Start test database
docker run -d --name test-db -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:15

# Run validation
DATABASE_URL=postgresql://postgres:test@localhost:5433/postgres npm run db:validate

# Cleanup
docker rm -f test-db
```

## Future Enhancements

- [ ] Validate column types and constraints
- [ ] Check foreign key relationships
- [ ] Verify trigger existence
- [ ] Validate function/procedure definitions
- [ ] Schema drift detection
- [ ] Automated remediation suggestions

## References

- [PostgreSQL Information Schema](https://www.postgresql.org/docs/current/information-schema.html)
- [Kubernetes Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)
- [Database Migration Best Practices](../migrations/README.md)
- [Data Model Documentation](./data-model.md)
