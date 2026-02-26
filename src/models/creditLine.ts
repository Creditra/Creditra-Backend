export enum CreditLineStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    CLOSED = 'closed'
}

export interface CreditLine {
    id: string;
    borrower: string;
    limit: number;
    utilized: number;
    interestRateBps: number;
    riskScore: number;
    status: CreditLineStatus | string;
    createdAt: string;
    updatedAt: string;
}
