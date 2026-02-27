import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CreditLineService } from '../CreditLineService.js';
import { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import { CreditLine, CreditLineStatus } from '../../models/CreditLine.js';

describe('CreditLineService', () => {
  let service: CreditLineService;
  let mockRepository: CreditLineRepository;

  beforeEach(() => {
    mockRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByWalletAddress: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn()
    };
    
    service = new CreditLineService(mockRepository);
  });

  describe('createCreditLine', () => {
    it('should create credit line successfully', async () => {
      const request = {
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      const expectedCreditLine: CreditLine = {
        id: 'cl-123',
        walletAddress: request.walletAddress,
        creditLimit: request.creditLimit,
        availableCredit: request.creditLimit,
        interestRateBps: request.interestRateBps,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.create).mockResolvedValue(expectedCreditLine);

      const result = await service.createCreditLine(request);

      expect(mockRepository.create).toHaveBeenCalledWith(request);
      expect(result).toEqual(expectedCreditLine);
    });

    it('should throw error for missing wallet address', async () => {
      const request = {
        walletAddress: '',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      await expect(service.createCreditLine(request)).rejects.toThrow('Wallet address is required');
    });

    it('should throw error for invalid credit limit', async () => {
      const request = {
        walletAddress: 'wallet123',
        creditLimit: '0',
        interestRateBps: 500
      };

      await expect(service.createCreditLine(request)).rejects.toThrow('Credit limit must be greater than 0');
    });

    it('should throw error for invalid interest rate', async () => {
      const request = {
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: -100
      };

      await expect(service.createCreditLine(request)).rejects.toThrow('Interest rate must be between 0 and 10000 basis points');
    });
  });

  describe('getCreditLine', () => {
    it('should return credit line when found', async () => {
      const creditLine: CreditLine = {
        id: 'cl-123',
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        availableCredit: '1000.00',
        interestRateBps: 500,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(creditLine);

      const result = await service.getCreditLine('cl-123');

      expect(mockRepository.findById).toHaveBeenCalledWith('cl-123');
      expect(result).toEqual(creditLine);
    });

    it('should return null when not found', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      const result = await service.getCreditLine('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getCreditLinesByWallet', () => {
    it('should return credit lines for wallet', async () => {
      const creditLines: CreditLine[] = [
        {
          id: 'cl-123',
          walletAddress: 'wallet123',
          creditLimit: '1000.00',
          availableCredit: '1000.00',
          interestRateBps: 500,
          status: CreditLineStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      vi.mocked(mockRepository.findByWalletAddress).mockResolvedValue(creditLines);

      const result = await service.getCreditLinesByWallet('wallet123');

      expect(mockRepository.findByWalletAddress).toHaveBeenCalledWith('wallet123');
      expect(result).toEqual(creditLines);
    });
  });

  describe('updateCreditLine', () => {
    it('should update credit line successfully', async () => {
      const updateRequest = {
        creditLimit: '2000.00',
        interestRateBps: 600
      };

      const updatedCreditLine: CreditLine = {
        id: 'cl-123',
        walletAddress: 'wallet123',
        creditLimit: '2000.00',
        availableCredit: '2000.00',
        interestRateBps: 600,
        status: CreditLineStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockRepository.update).mockResolvedValue(updatedCreditLine);

      const result = await service.updateCreditLine('cl-123', updateRequest);

      expect(mockRepository.update).toHaveBeenCalledWith('cl-123', updateRequest);
      expect(result).toEqual(updatedCreditLine);
    });

    it('should throw error for invalid credit limit', async () => {
      const updateRequest = {
        creditLimit: '-100.00'
      };

      await expect(service.updateCreditLine('cl-123', updateRequest)).rejects.toThrow('Credit limit must be greater than 0');
    });

    it('should throw error for invalid interest rate', async () => {
      const updateRequest = {
        interestRateBps: 15000
      };

      await expect(service.updateCreditLine('cl-123', updateRequest)).rejects.toThrow('Interest rate must be between 0 and 10000 basis points');
    });
  });

  describe('deleteCreditLine', () => {
    it('should delete credit line successfully', async () => {
      vi.mocked(mockRepository.delete).mockResolvedValue(true);

      const result = await service.deleteCreditLine('cl-123');

      expect(mockRepository.delete).toHaveBeenCalledWith('cl-123');
      expect(result).toBe(true);
    });
  });

  describe('getCreditLineCount', () => {
    it('should return count', async () => {
      vi.mocked(mockRepository.count).mockResolvedValue(5);

      const result = await service.getCreditLineCount();

      expect(mockRepository.count).toHaveBeenCalled();
      expect(result).toBe(5);
    });
  });
});