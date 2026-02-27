export interface CreditLine {
  id: string;
  walletAddress: string;
  creditLimit: string; // Using string for precise decimal handling
  availableCredit: string;
  interestRateBps: number; // Basis points (e.g., 500 = 5%)
  status: CreditLineStatus;
  createdAt: Date;
  updatedAt: Date;
}

export enum CreditLineStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
  PENDING = 'pending'
}

export interface CreateCreditLineRequest {
  walletAddress: string;
  creditLimit: string;
  interestRateBps: number;
}

export interface UpdateCreditLineRequest {
  creditLimit?: string;
  interestRateBps?: number;
  status?: CreditLineStatus;
}