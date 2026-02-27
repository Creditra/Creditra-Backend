import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../Container.js';
import { InMemoryCreditLineRepository } from '../../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryRiskEvaluationRepository } from '../../repositories/memory/InMemoryRiskEvaluationRepository.js';
import { InMemoryTransactionRepository } from '../../repositories/memory/InMemoryTransactionRepository.js';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    // Reset singleton for each test
    Container['instance'] = undefined as any;
    container = Container.getInstance();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = Container.getInstance();
      const instance2 = Container.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should initialize with default repositories and services', () => {
      expect(container.creditLineRepository).toBeInstanceOf(InMemoryCreditLineRepository);
      expect(container.riskEvaluationRepository).toBeInstanceOf(InMemoryRiskEvaluationRepository);
      expect(container.transactionRepository).toBeInstanceOf(InMemoryTransactionRepository);
      expect(container.creditLineService).toBeDefined();
      expect(container.riskEvaluationService).toBeDefined();
    });
  });

  describe('setRepositories', () => {
    it('should replace credit line repository and service', () => {
      const newCreditLineRepo = new InMemoryCreditLineRepository();
      const originalService = container.creditLineService;

      container.setRepositories({
        creditLineRepository: newCreditLineRepo
      });

      expect(container.creditLineRepository).toBe(newCreditLineRepo);
      expect(container.creditLineService).not.toBe(originalService);
    });

    it('should replace risk evaluation repository and service', () => {
      const newRiskRepo = new InMemoryRiskEvaluationRepository();
      const originalService = container.riskEvaluationService;

      container.setRepositories({
        riskEvaluationRepository: newRiskRepo
      });

      expect(container.riskEvaluationRepository).toBe(newRiskRepo);
      expect(container.riskEvaluationService).not.toBe(originalService);
    });

    it('should replace transaction repository', () => {
      const newTransactionRepo = new InMemoryTransactionRepository();

      container.setRepositories({
        transactionRepository: newTransactionRepo
      });

      expect(container.transactionRepository).toBe(newTransactionRepo);
    });

    it('should replace multiple repositories at once', () => {
      const newCreditLineRepo = new InMemoryCreditLineRepository();
      const newRiskRepo = new InMemoryRiskEvaluationRepository();
      const newTransactionRepo = new InMemoryTransactionRepository();

      container.setRepositories({
        creditLineRepository: newCreditLineRepo,
        riskEvaluationRepository: newRiskRepo,
        transactionRepository: newTransactionRepo
      });

      expect(container.creditLineRepository).toBe(newCreditLineRepo);
      expect(container.riskEvaluationRepository).toBe(newRiskRepo);
      expect(container.transactionRepository).toBe(newTransactionRepo);
    });

    it('should not affect other repositories when replacing one', () => {
      const originalRiskRepo = container.riskEvaluationRepository;
      const originalTransactionRepo = container.transactionRepository;
      const newCreditLineRepo = new InMemoryCreditLineRepository();

      container.setRepositories({
        creditLineRepository: newCreditLineRepo
      });

      expect(container.riskEvaluationRepository).toBe(originalRiskRepo);
      expect(container.transactionRepository).toBe(originalTransactionRepo);
    });
  });
});