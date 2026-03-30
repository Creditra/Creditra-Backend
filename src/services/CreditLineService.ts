import { CreditLineStatus, type CreditLine, type CreateCreditLineRequest, type UpdateCreditLineRequest } from '../models/CreditLine.js';
import type { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';

export class CreditLineService {
  constructor(private creditLineRepository: CreditLineRepository) {}

  async createCreditLine(request: CreateCreditLineRequest): Promise<CreditLine> {
    // Validate request
    if (!request.walletAddress) {
      throw new Error('Wallet address is required');
    }
    
    if (!request.creditLimit || parseFloat(request.creditLimit) <= 0) {
      throw new Error('Credit limit must be greater than 0');
    }

    if (request.interestRateBps < 0 || request.interestRateBps > 10000) {
      throw new Error('Interest rate must be between 0 and 10000 basis points');
    }

    return await this.creditLineRepository.create(request);
  }

  async getCreditLine(id: string): Promise<CreditLine | null> {
    return await this.creditLineRepository.findById(id);
  }

  async getCreditLinesByWallet(walletAddress: string): Promise<CreditLine[]> {
    return await this.creditLineRepository.findByWalletAddress(walletAddress);
  }

  async getAllCreditLines(offset?: number, limit?: number): Promise<CreditLine[]> {
    if (offset !== undefined && offset < 0) {
      throw new Error('Offset cannot be negative');
    }
    if (limit !== undefined && limit <= 0) {
      throw new Error('Limit must be greater than 0');
    }
    if (limit !== undefined && limit > 100) {
      throw new Error('Limit cannot exceed 100');
    }
    return await this.creditLineRepository.findAll(offset, limit);
  }

  async updateCreditLine(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null> {
    // Validate update request
    if (request.creditLimit && parseFloat(request.creditLimit) <= 0) {
      throw new Error('Credit limit must be greater than 0');
    }

    if (request.interestRateBps !== undefined && 
        (request.interestRateBps < 0 || request.interestRateBps > 10000)) {
      throw new Error('Interest rate must be between 0 and 10000 basis points');
    }

    return await this.creditLineRepository.update(id, request);
  }

  async deleteCreditLine(id: string): Promise<boolean> {
    return await this.creditLineRepository.delete(id);
  }

  async getCreditLineCount(): Promise<number> {
    return await this.creditLineRepository.count();
  }

  async draw(id: string, borrowerId: string, amount: string): Promise<CreditLine> {
    const line = await this.creditLineRepository.findById(id);
    if (!line) {
      throw new Error('Credit line not found');
    }

    if (line.walletAddress !== borrowerId) {
      throw new Error('Unauthorized');
    }

    if (line.status !== CreditLineStatus.ACTIVE) {
      throw new Error('Credit line is not active');
    }

    const amountNum = parseFloat(amount);
    const limitNum = parseFloat(line.creditLimit);
    const utilizedNum = parseFloat(line.utilized || '0');

    if (utilizedNum + amountNum > limitNum) {
      throw new Error('Credit limit exceeded');
    }

    return await this.creditLineRepository.update(id, {
      utilized: (utilizedNum + amountNum).toString(),
    }) as CreditLine;
  }

  async repay(id: string, walletAddress: string, amount: string): Promise<CreditLine> {
    const line = await this.creditLineRepository.findById(id);
    if (!line) {
      throw new Error('Credit line not found');
    }

    const amountNum = parseFloat(amount);
    const utilizedNum = parseFloat(line.utilized || '0');

    return await this.creditLineRepository.update(id, {
      utilized: Math.max(0, utilizedNum - amountNum).toString(),
    }) as CreditLine;
  }
}