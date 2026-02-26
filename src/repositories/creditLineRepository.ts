import { CreditLine, CreditLineStatus } from '../models/creditLine.js';

export interface ICreditLineRepository {
    findAll(): Promise<CreditLine[]>;
    findById(id: string): Promise<CreditLine | null>;
}

export class MockCreditLineRepository implements ICreditLineRepository {
    private creditLines: CreditLine[] = [
        {
            id: 'cl_001',
            borrower: 'borrower_abc123',
            limit: 100000,
            utilized: 25000,
            interestRateBps: 1200, // 12.00%
            riskScore: 750,
            status: CreditLineStatus.ACTIVE,
            createdAt: new Date('2025-01-10T00:00:00Z').toISOString(),
            updatedAt: new Date('2025-02-15T00:00:00Z').toISOString(),
        },
        {
            id: 'cl_002',
            borrower: 'borrower_xyz789',
            limit: 50000,
            utilized: 45000,
            interestRateBps: 1800, // 18.00%
            riskScore: 620,
            status: CreditLineStatus.SUSPENDED,
            createdAt: new Date('2024-11-05T00:00:00Z').toISOString(),
            updatedAt: new Date('2025-02-20T00:00:00Z').toISOString(),
        }
    ];

    async findAll(): Promise<CreditLine[]> {
        return Promise.resolve(this.creditLines);
    }

    async findById(id: string): Promise<CreditLine | null> {
        const line = this.creditLines.find(l => l.id === id);
        return Promise.resolve(line || null);
    }
}
