# Repository Architecture

This document describes the repository abstraction pattern implemented in the Creditra backend to prepare for database integration while maintaining loose coupling.

## Overview

The repository pattern provides a clean abstraction layer between the business logic (services) and data access, making it easy to swap between different data storage implementations without changing the core application logic.

## Architecture Layers

```
Routes → Services → Repositories → Data Sources
```

### 1. Models (`src/models/`)
Define the core data structures and types:
- `CreditLine.ts` - Credit line entities and related types
- `RiskEvaluation.ts` - Risk evaluation entities and factors
- `Transaction.ts` - Transaction entities and status types

### 2. Repository Interfaces (`src/repositories/interfaces/`)
Define contracts for data access operations:
- `CreditLineRepository.ts` - CRUD operations for credit lines
- `RiskEvaluationRepository.ts` - Risk evaluation storage and retrieval
- `TransactionRepository.ts` - Transaction logging and querying

### 3. Repository Implementations (`src/repositories/memory/`)
Current in-memory implementations:
- `InMemoryCreditLineRepository.ts` - Memory-based credit line storage
- `InMemoryRiskEvaluationRepository.ts` - Memory-based risk evaluation storage
- `InMemoryTransactionRepository.ts` - Memory-based transaction storage

### 4. Services (`src/services/`)
Business logic layer that uses repositories:
- `CreditLineService.ts` - Credit line management and validation
- `RiskEvaluationService.ts` - Risk assessment and caching logic

### 5. Dependency Injection (`src/container/`)
- `Container.ts` - Manages repository and service instances

## Key Benefits

### 1. **Database Agnostic**
The application logic doesn't depend on specific database implementations. You can easily switch from in-memory storage to PostgreSQL, MongoDB, or any other database.

### 2. **Testability**
Services can be tested with mock repositories, and repositories can be tested independently with their own test suites.

### 3. **Separation of Concerns**
- Routes handle HTTP concerns (request/response)
- Services handle business logic and validation
- Repositories handle data persistence

### 4. **Easy Migration Path**
When ready to integrate a real database:
1. Create new repository implementations (e.g., `PostgresCreditLineRepository`)
2. Update the container to use the new implementations
3. No changes needed in services or routes

## Repository Interface Design

Each repository interface follows consistent patterns:

### Standard Operations
- `create()` - Create new entities
- `findById()` - Find by primary key
- `findAll()` - List with pagination
- `update()` - Update existing entities
- `delete()` - Remove entities
- `count()` - Get total count

### Domain-Specific Operations
- `findByWalletAddress()` - Find entities by wallet
- `findLatestByWalletAddress()` - Get most recent evaluation
- `deleteExpired()` - Cleanup expired data
- `isValid()` - Check data validity

## Usage Examples

### Creating a Credit Line
```typescript
const container = Container.getInstance();
const creditLine = await container.creditLineService.createCreditLine({
  walletAddress: 'wallet123',
  creditLimit: '1000.00',
  interestRateBps: 500
});
```

### Risk Evaluation
```typescript
const result = await container.riskEvaluationService.evaluateRisk({
  walletAddress: 'wallet123',
  forceRefresh: false
});
```

## Future Database Integration

To integrate PostgreSQL (or any other database):

1. **Create Database Repository Implementations**
```typescript
export class PostgresCreditLineRepository implements CreditLineRepository {
  constructor(private db: Pool) {}
  
  async create(request: CreateCreditLineRequest): Promise<CreditLine> {
    const query = 'INSERT INTO credit_lines (wallet_address, credit_limit, interest_rate_bps) VALUES ($1, $2, $3) RETURNING *';
    const result = await this.db.query(query, [request.walletAddress, request.creditLimit, request.interestRateBps]);
    return mapRowToCreditLine(result.rows[0]);
  }
  
  // ... other methods
}
```

2. **Update Container Configuration**
```typescript
// In Container.ts constructor
if (process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  this._creditLineRepository = new PostgresCreditLineRepository(pool);
} else {
  this._creditLineRepository = new InMemoryCreditLineRepository();
}
```

3. **No Changes Required**
- Services continue to work unchanged
- Routes continue to work unchanged
- Tests continue to work with mock repositories

## Testing Strategy

### Repository Tests
- Test each repository implementation independently
- Verify all interface methods work correctly
- Test edge cases and error conditions

### Service Tests
- Use mock repositories to isolate business logic
- Test validation rules and business constraints
- Test error handling and edge cases

### Integration Tests
- Test complete request/response cycles
- Verify data persistence across requests
- Test API contracts and error responses

## Performance Considerations

### In-Memory Implementation
- Fast for development and testing
- Data lost on restart
- Memory usage grows with data

### Future Database Implementation
- Persistent storage
- Better performance for large datasets
- Support for complex queries and indexing
- Transaction support for data consistency

## Security Considerations

### Input Validation
- All user inputs validated at service layer
- Type safety enforced through TypeScript interfaces
- Sanitization of wallet addresses and amounts

### Data Access Control
- Repository interfaces don't expose internal implementation details
- Services control access patterns and business rules
- Easy to add authorization checks at service layer

## Monitoring and Observability

The repository pattern makes it easy to add:
- Query performance monitoring
- Data access logging
- Metrics collection
- Error tracking

Future database implementations can include:
- Connection pool monitoring
- Query execution time tracking
- Database health checks
- Automated failover support