import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskEvaluationService } from '../RiskEvaluationService.js';
import { RiskEvaluationRepository } from '../../repositories/interfaces/RiskEvaluationRepository.js';
import { RiskEvaluation } from '../../models/RiskEvaluation.js';

describe('RiskEvaluationService', () => {
  let service: RiskEvaluationService;
  let mockRepository: RiskEvaluationRepository;

  beforeEach(() => {
    mockRepository = {
      save: vi.fn(),
      findLatestByWalletAddress: vi.fn(),
      findById: vi.fn(),
      findByWalletAddress: vi.fn(),
      deleteExpired: vi.fn(),
      isValid: vi.fn(),
      findAll: vi.fn(),
      count: vi.fn()
    };
    
    service = new RiskEvaluationService(mockRepository);
  });

  describe('evaluateRisk', () => {
    it('should throw error for missing wallet address', async () => {
      const request = { walletAddress: '' };

      await expect(service.evaluateRisk(request)).rejects.toThrow('Wallet address is required');
    });

    it('should return cached evaluation when valid', async () => {
      const walletAddress = 'wallet123';
      const request = { walletAddress };

      const cachedEvaluation: RiskEvaluation = {
        id: 'eval-123',
        walletAddress,
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      vi.mocked(mockRepository.isValid).mockResolvedValue(true);
      vi.mocked(mockRepository.findLatestByWalletAddress).mockResolvedValue(cachedEvaluation);

      const result = await service.evaluateRisk(request);

      expect(result.walletAddress).toBe(walletAddress);
      expect(result.riskScore).toBe(75);
      expect(result.creditLimit).toBe('1000.00');
      expect(result.interestRateBps).toBe(500);
      expect(result.message).toBe('Using cached risk evaluation');
    });

    it('should perform new evaluation when no valid cache', async () => {
      const walletAddress = 'wallet123';
      const request = { walletAddress };

      vi.mocked(mockRepository.isValid).mockResolvedValue(false);
      vi.mocked(mockRepository.save).mockResolvedValue({
        id: 'eval-123',
        walletAddress,
        riskScore: 70,
        creditLimit: '700.00',
        interestRateBps: 650,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      const result = await service.evaluateRisk(request);

      expect(result.walletAddress).toBe(walletAddress);
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.creditLimit).toBeDefined();
      expect(result.interestRateBps).toBeGreaterThan(0);
      expect(result.message).toBe('New risk evaluation completed');
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should force new evaluation when forceRefresh is true', async () => {
      const walletAddress = 'wallet123';
      const request = { walletAddress, forceRefresh: true };

      vi.mocked(mockRepository.save).mockResolvedValue({
        id: 'eval-123',
        walletAddress,
        riskScore: 80,
        creditLimit: '800.00',
        interestRateBps: 550,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      const result = await service.evaluateRisk(request);

      expect(result.message).toBe('New risk evaluation completed');
      expect(mockRepository.save).toHaveBeenCalled();
      // Should not check cache when forceRefresh is true
      expect(mockRepository.isValid).not.toHaveBeenCalled();
    });
  });

  describe('getRiskEvaluation', () => {
    it('should return evaluation when found', async () => {
      const evaluation: RiskEvaluation = {
        id: 'eval-123',
        walletAddress: 'wallet123',
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      vi.mocked(mockRepository.findById).mockResolvedValue(evaluation);

      const result = await service.getRiskEvaluation('eval-123');

      expect(mockRepository.findById).toHaveBeenCalledWith('eval-123');
      expect(result).toEqual(evaluation);
    });

    it('should return null when not found', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(null);

      const result = await service.getRiskEvaluation('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getLatestRiskEvaluation', () => {
    it('should return latest evaluation for wallet', async () => {
      const evaluation: RiskEvaluation = {
        id: 'eval-123',
        walletAddress: 'wallet123',
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      vi.mocked(mockRepository.findLatestByWalletAddress).mockResolvedValue(evaluation);

      const result = await service.getLatestRiskEvaluation('wallet123');

      expect(mockRepository.findLatestByWalletAddress).toHaveBeenCalledWith('wallet123');
      expect(result).toEqual(evaluation);
    });
  });

  describe('getRiskEvaluationHistory', () => {
    it('should return evaluation history for wallet', async () => {
      const evaluations: RiskEvaluation[] = [
        {
          id: 'eval-123',
          walletAddress: 'wallet123',
          riskScore: 75,
          creditLimit: '1000.00',
          interestRateBps: 500,
          factors: [],
          evaluatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      ];

      vi.mocked(mockRepository.findByWalletAddress).mockResolvedValue(evaluations);

      const result = await service.getRiskEvaluationHistory('wallet123', 0, 10);

      expect(mockRepository.findByWalletAddress).toHaveBeenCalledWith('wallet123', 0, 10);
      expect(result).toEqual(evaluations);
    });
  });

  describe('cleanupExpiredEvaluations', () => {
    it('should cleanup expired evaluations', async () => {
      vi.mocked(mockRepository.deleteExpired).mockResolvedValue(5);

      const result = await service.cleanupExpiredEvaluations();

      expect(mockRepository.deleteExpired).toHaveBeenCalled();
      expect(result).toBe(5);
    });
  });
});