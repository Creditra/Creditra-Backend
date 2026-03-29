export interface Transaction {
  id: string;
  creditLineId: string;
  walletAddress: string;
  amount: string;
  type: TransactionType;
  status: TransactionStatus;
  blockchainTxHash?: string;
  createdAt: Date;
  processedAt?: Date;
}

export enum TransactionType {
  BORROW = 'borrow',
  REPAY = 'repay',
  INTEREST_ACCRUAL = 'interest_accrual',
  FEE = 'fee'
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface CreateTransactionRequest {
  creditLineId: string;
  amount: string;
  type: TransactionType;
  blockchainTxHash?: string;
}