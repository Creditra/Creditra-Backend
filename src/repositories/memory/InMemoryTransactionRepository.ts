import { Transaction, CreateTransactionRequest, TransactionStatus, TransactionType } from '../../models/Transaction.js';
import { TransactionRepository } from '../interfaces/TransactionRepository.js';
import { randomUUID } from 'crypto';

export class InMemoryTransactionRepository implements TransactionRepository {
  private transactions: Map<string, Transaction> = new Map();

  async create(request: CreateTransactionRequest): Promise<Transaction> {
    const id = randomUUID();
    const now = new Date();

    const transaction: Transaction = {
      id,
      creditLineId: request.creditLineId,
      walletAddress: '', // Will be set by service layer
      amount: request.amount,
      type: request.type,
      status: TransactionStatus.PENDING,
      blockchainTxHash: request.blockchainTxHash,
      createdAt: now
    };

    this.transactions.set(id, transaction);
    return transaction;
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.transactions.get(id) || null;
  }

  async findByCreditLineId(creditLineId: string, offset = 0, limit = 100): Promise<Transaction[]> {
    const filtered = Array.from(this.transactions.values())
      .filter(tx => tx.creditLineId === creditLineId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return filtered.slice(offset, offset + limit);
  }

  async findByWalletAddress(walletAddress: string, offset = 0, limit = 100): Promise<Transaction[]> {
    const filtered = Array.from(this.transactions.values())
      .filter(tx => tx.walletAddress === walletAddress)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return filtered.slice(offset, offset + limit);
  }

  async updateStatus(id: string, status: TransactionStatus, processedAt?: Date): Promise<Transaction | null> {
    const existing = this.transactions.get(id);
    if (!existing) {
      return null;
    }

    const updated: Transaction = {
      ...existing,
      status,
      processedAt: processedAt || new Date()
    };

    this.transactions.set(id, updated);
    return updated;
  }

  async findAll(offset = 0, limit = 100): Promise<Transaction[]> {
    const all = Array.from(this.transactions.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return all.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.transactions.size;
  }

  async findByStatus(status: TransactionStatus, offset = 0, limit = 100): Promise<Transaction[]> {
    const filtered = Array.from(this.transactions.values())
      .filter(tx => tx.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return filtered.slice(offset, offset + limit);
  }

  // Helper method for testing
  clear(): void {
    this.transactions.clear();
  }
}