import { CreditLine, CreditLineStatus } from '../models/creditLine.js';

// ---------------------------------------------------------------------------
// In-memory seed data
// Replace this slice with real DB queries once a database is wired up.
// ---------------------------------------------------------------------------
const SEED_CREDIT_LINES: CreditLine[] = [
  {
    id: 'a1b2c3d4-0001-0001-0001-000000000001',
    borrowerId: 'b0000001-0000-0000-0000-000000000001',
    limitCents: 50_000_00,          // $50,000
    utilizedCents: 12_500_00,       // $12,500
    interestRateBps: 1250,          // 12.50 %
    riskScore: 0.18,
    status: CreditLineStatus.Active,
    createdAt: new Date('2025-01-15T09:00:00.000Z'),
    updatedAt: new Date('2025-06-01T14:23:00.000Z'),
  },
  {
    id: 'a1b2c3d4-0002-0002-0002-000000000002',
    borrowerId: 'b0000002-0000-0000-0000-000000000002',
    limitCents: 100_000_00,         // $100,000
    utilizedCents: 0,
    interestRateBps: 950,           // 9.50 %
    riskScore: 0.07,
    status: CreditLineStatus.Active,
    createdAt: new Date('2025-03-10T11:30:00.000Z'),
    updatedAt: new Date('2025-03-10T11:30:00.000Z'),
  },
  {
    id: 'a1b2c3d4-0003-0003-0003-000000000003',
    borrowerId: 'b0000003-0000-0000-0000-000000000003',
    limitCents: 25_000_00,          // $25,000
    utilizedCents: 25_000_00,       // fully drawn
    interestRateBps: 1875,          // 18.75 %
    riskScore: 0.61,
    status: CreditLineStatus.Suspended,
    createdAt: new Date('2024-11-20T08:00:00.000Z'),
    updatedAt: new Date('2025-05-15T17:00:00.000Z'),
  },
];

// ---------------------------------------------------------------------------
// Repository interface — swap the implementation for a DB-backed class later
// without touching route code.
// ---------------------------------------------------------------------------
export interface ICreditLineRepository {
  findAll(): Promise<CreditLine[]>;
  findById(id: string): Promise<CreditLine | undefined>;
}

export class InMemoryCreditLineRepository implements ICreditLineRepository {
  private readonly store: Map<string, CreditLine>;

  constructor(seed: CreditLine[] = SEED_CREDIT_LINES) {
    this.store = new Map(seed.map((cl) => [cl.id, cl]));
  }

  async findAll(): Promise<CreditLine[]> {
    return Array.from(this.store.values());
  }

  async findById(id: string): Promise<CreditLine | undefined> {
    return this.store.get(id);
  }
}

// Singleton used by the route layer.
// Swap this out for a DB-backed implementation during the database migration.
export const creditLineRepository: ICreditLineRepository =
  new InMemoryCreditLineRepository();