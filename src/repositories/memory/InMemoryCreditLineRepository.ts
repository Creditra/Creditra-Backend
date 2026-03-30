import{ type CreditLine, type CreateCreditLineRequest, type UpdateCreditLineRequest, CreditLineStatus } from '../../models/CreditLine.js';
import type{ CreditLineRepository } from '../interfaces/CreditLineRepository.js';
import { randomUUID } from 'crypto';

export class InMemoryCreditLineRepository implements CreditLineRepository {
  private creditLines: Map<string, CreditLine> = new Map();

  private sortByNewest(creditLines: CreditLine[]): CreditLine[] {
    return creditLines.sort((a, b) => {
      const tsDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (tsDiff !== 0) return tsDiff;
      return a.id.localeCompare(b.id);
    });
  }

  async create(request: CreateCreditLineRequest): Promise<CreditLine> {
    const id = randomUUID();
    const now = new Date();
    
    const creditLine: CreditLine = {
      id,
      walletAddress: request.walletAddress,
      creditLimit: request.creditLimit,
      availableCredit: request.creditLimit, // Initially full credit available
      interestRateBps: request.interestRateBps,
      status: CreditLineStatus.ACTIVE,
      createdAt: now,
      updatedAt: now
    };

    this.creditLines.set(id, creditLine);
    return creditLine;
  }

  async findById(id: string): Promise<CreditLine | null> {
    return this.creditLines.get(id) || null;
  }

  async findByWalletAddress(walletAddress: string): Promise<CreditLine[]> {
    const filtered = Array.from(this.creditLines.values()).filter(cl => cl.walletAddress === walletAddress);
    return this.sortByNewest(filtered);
  }

  async findAll(offset = 0, limit = 100): Promise<CreditLine[]> {
    const all = this.sortByNewest(Array.from(this.creditLines.values()));
    return all.slice(offset, offset + limit);
  }

  async update(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null> {
    const existing = this.creditLines.get(id);
    if (!existing) {
      return null;
    }

    const updated: CreditLine = {
      ...existing,
      ...request,
      updatedAt: new Date()
    };

    // If credit limit changed, adjust available credit proportionally
    if (request.creditLimit && request.creditLimit !== existing.creditLimit) {
      const oldLimit = parseFloat(existing.creditLimit);
      const newLimit = parseFloat(request.creditLimit);
      const oldAvailable = parseFloat(existing.availableCredit);
      
      // Maintain the same ratio of available credit
      const ratio = oldLimit > 0 ? oldAvailable / oldLimit : 1;
      updated.availableCredit = (newLimit * ratio).toString();
    }

    this.creditLines.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.creditLines.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.creditLines.has(id);
  }

  async count(): Promise<number> {
    return this.creditLines.size;
  }

  // Helper method for testing
  clear(): void {
    this.creditLines.clear();
  }
}