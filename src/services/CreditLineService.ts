import { CreditLine, CreateCreditLineRequest, UpdateCreditLineRequest } from '../models/CreditLine.js';
import { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';

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
}