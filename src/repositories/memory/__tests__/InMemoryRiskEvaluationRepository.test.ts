import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRiskEvaluationRepository } from '../InMemoryRiskEvaluationRepository.js';

describe('InMemoryRiskEvaluationRepository', () => {
  let repository: InMemoryRiskEvaluationRepository;

  beforeEach(() => {
    repository = new InMemoryRiskEvaluationRepository();
  });

  describe('save', () => {
    it('should save a new risk evaluation', async () => {
      const evaluation = {
        walletAddress: 'wallet123',
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      const saved = await repository.save(evaluation);

      expect(saved.id).toBeDefined();
      expect(saved.walletAddress).toBe(evaluation.walletAddress);
      expect(saved.riskScore).toBe(evaluation.riskScore);
      expect(saved.creditLimit).toBe(evaluation.creditLimit);
      expect(saved.interestRateBps).toBe(evaluation.interestRateBps);
    });
  });

  describe('findLatestByWalletAddress', () => {
    it('should return latest evaluation for wallet', async () => {
      const walletAddress = 'wallet123';
      const now = new Date();
      
      // Create older evaluation
      await repository.save({
        walletAddress,
        riskScore: 70,
        creditLimit: '800.00',
        interestRateBps: 600,
        factors: [],
        evaluatedAt: new Date(now.getTime() - 60000), // 1 minute ago
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      });

      // Create newer evaluation
      const newer = await repository.save({
        walletAddress,
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      });

      const latest = await repository.findLatestByWalletAddress(walletAddress);
      expect(latest).toEqual(newer);
    });

    it('should return null when no evaluation found', async () => {
      const latest = await repository.findLatestByWalletAddress('nonexistent');
      expect(latest).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return evaluation when found', async () => {
      const saved = await repository.save({
        walletAddress: 'wallet123',
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      const found = await repository.findById(saved.id);
      expect(found).toEqual(saved);
    });

    it('should return null when not found', async () => {
      const found = await repository.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByWalletAddress', () => {
    it('should return evaluations for wallet address sorted by date', async () => {
      const walletAddress = 'wallet123';
      const now = new Date();

      const eval1 = await repository.save({
        walletAddress,
        riskScore: 70,
        creditLimit: '800.00',
        interestRateBps: 600,
        factors: [],
        evaluatedAt: new Date(now.getTime() - 120000), // 2 minutes ago
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      });

      const eval2 = await repository.save({
        walletAddress,
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(now.getTime() - 60000), // 1 minute ago
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      });

      const evaluations = await repository.findByWalletAddress(walletAddress);
      expect(evaluations).toHaveLength(2);
      expect(evaluations[0]).toEqual(eval2); // Most recent first
      expect(evaluations[1]).toEqual(eval1);
    });

    it('should support pagination', async () => {
      const walletAddress = 'wallet123';
      
      // Create 5 evaluations
      for (let i = 0; i < 5; i++) {
        await repository.save({
          walletAddress,
          riskScore: 70 + i,
          creditLimit: '1000.00',
          interestRateBps: 500,
          factors: [],
          evaluatedAt: new Date(Date.now() - i * 60000),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
      }

      const paginated = await repository.findByWalletAddress(walletAddress, 2, 2);
      expect(paginated).toHaveLength(2);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired evaluations', async () => {
      const now = new Date();
      
      // Create expired evaluation
      await repository.save({
        walletAddress: 'wallet1',
        riskScore: 70,
        creditLimit: '800.00',
        interestRateBps: 600,
        factors: [],
        evaluatedAt: new Date(now.getTime() - 60000),
        expiresAt: new Date(now.getTime() - 1000) // Expired 1 second ago
      });

      // Create valid evaluation
      await repository.save({
        walletAddress: 'wallet2',
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      });

      const deletedCount = await repository.deleteExpired();
      expect(deletedCount).toBe(1);

      const remaining = await repository.findAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].walletAddress).toBe('wallet2');
    });
  });

  describe('isValid', () => {
    it('should return true for valid evaluation', async () => {
      const walletAddress = 'wallet123';
      
      await repository.save({
        walletAddress,
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      const isValid = await repository.isValid(walletAddress);
      expect(isValid).toBe(true);
    });

    it('should return false for expired evaluation', async () => {
      const walletAddress = 'wallet123';
      
      await repository.save({
        walletAddress,
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000) // Expired
      });

      const isValid = await repository.isValid(walletAddress);
      expect(isValid).toBe(false);
    });

    it('should return false when no evaluation exists', async () => {
      const isValid = await repository.isValid('nonexistent');
      expect(isValid).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should return all evaluations with pagination', async () => {
      // Create 3 evaluations
      for (let i = 0; i < 3; i++) {
        await repository.save({
          walletAddress: `wallet${i}`,
          riskScore: 70 + i,
          creditLimit: '1000.00',
          interestRateBps: 500,
          factors: [],
          evaluatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
      }

      const all = await repository.findAll();
      expect(all).toHaveLength(3);

      const paginated = await repository.findAll(1, 1);
      expect(paginated).toHaveLength(1);
    });
  });

  describe('count', () => {
    it('should return correct count', async () => {
      expect(await repository.count()).toBe(0);

      await repository.save({
        walletAddress: 'wallet1',
        riskScore: 75,
        creditLimit: '1000.00',
        interestRateBps: 500,
        factors: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      expect(await repository.count()).toBe(1);
    });
  });
});