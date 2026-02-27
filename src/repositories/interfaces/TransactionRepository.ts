import { Transaction, CreateTransactionRequest, TransactionStatus } from '../../models/Transaction.js';

export interface TransactionRepository {
  /**
   * Create a new transaction
   */
  create(request: CreateTransactionRequest): Promise<Transaction>;

  /**
   * Find transaction by ID
   */
  findById(id: string): Promise<Transaction | null>;

  /**
   * Find transactions by credit line ID
   */
  findByCreditLineId(creditLineId: string, offset?: number, limit?: number): Promise<Transaction[]>;

  /**
   * Find transactions by wallet address
   */
  findByWalletAddress(walletAddress: string, offset?: number, limit?: number): Promise<Transaction[]>;

  /**
   * Update transaction status
   */
  updateStatus(id: string, status: TransactionStatus, processedAt?: Date): Promise<Transaction | null>;

  /**
   * Get all transactions with optional pagination
   */
  findAll(offset?: number, limit?: number): Promise<Transaction[]>;

  /**
   * Get total count of transactions
   */
  count(): Promise<number>;

  /**
   * Get transactions by status
   */
  findByStatus(status: TransactionStatus, offset?: number, limit?: number): Promise<Transaction[]>;
}