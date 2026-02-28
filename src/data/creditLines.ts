export interface CreditLine {
  id: string;
  borrower: string;
  status: 'active' | 'pending' | 'closed' | 'defaulted';
  creditLimit: string;
  interestRateBps: number;
  createdAt: string;
}

export const creditLines: CreditLine[] = [
  { id: '1', borrower: 'wallet_aaa', status: 'active', creditLimit: '5000', interestRateBps: 300, createdAt: '2024-01-01' },
  { id: '2', borrower: 'wallet_bbb', status: 'pending', creditLimit: '2000', interestRateBps: 450, createdAt: '2024-01-02' },
  { id: '3', borrower: 'wallet_ccc', status: 'closed', creditLimit: '8000', interestRateBps: 200, createdAt: '2024-01-03' },
  { id: '4', borrower: 'wallet_ddd', status: 'active', creditLimit: '3000', interestRateBps: 350, createdAt: '2024-01-04' },
  { id: '5', borrower: 'wallet_eee', status: 'defaulted', creditLimit: '1000', interestRateBps: 500, createdAt: '2024-01-05' },
  { id: '6', borrower: 'wallet_fff', status: 'active', creditLimit: '7000', interestRateBps: 250, createdAt: '2024-01-06' },
  { id: '7', borrower: 'wallet_ggg', status: 'pending', creditLimit: '4000', interestRateBps: 400, createdAt: '2024-01-07' },
  { id: '8', borrower: 'wallet_hhh', status: 'active', creditLimit: '6000', interestRateBps: 275, createdAt: '2024-01-08' },
];
