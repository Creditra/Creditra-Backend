import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCreditLineRepository } from '../InMemoryCreditLineRepository.js';
import { CreditLineStatus } from '../../../models/CreditLine.js';

describe('InMemoryCreditLineRepository', () => {
  let repository: InMemoryCreditLineRepository;

  beforeEach(() => {
    repository = new InMemoryCreditLineRepository();
  });

  describe('create', () => {
    it('should create a new credit line', async () => {
      const request = {
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      const creditLine = await repository.create(request);

      expect(creditLine.id).toBeDefined();
      expect(creditLine.walletAddress).toBe(request.walletAddress);
      expect(creditLine.creditLimit).toBe(request.creditLimit);
      expect(creditLine.availableCredit).toBe(request.creditLimit);
      expect(creditLine.interestRateBps).toBe(request.interestRateBps);
      expect(creditLine.status).toBe(CreditLineStatus.ACTIVE);
      expect(creditLine.createdAt).toBeInstanceOf(Date);
      expect(creditLine.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('findById', () => {
    it('should return credit line when found', async () => {
      const request = {
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      };

      const created = await repository.create(request);
      const found = await repository.findById(created.id);

      expect(found).toEqual(created);
    });

    it('should return null when not found', async () => {
      const found = await repository.findById('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findByWalletAddress', () => {
    it('should return credit lines for wallet address', async () => {
      const walletAddress = 'wallet123';
      
      await repository.create({
        walletAddress,
        creditLimit: '1000.00',
        interestRateBps: 500
      });
      
      await repository.create({
        walletAddress,
        creditLimit: '2000.00',
        interestRateBps: 600
      });

      await repository.create({
        walletAddress: 'other-wallet',
        creditLimit: '500.00',
        interestRateBps: 400
      });

      const creditLines = await repository.findByWalletAddress(walletAddress);
      expect(creditLines).toHaveLength(2);
      expect(creditLines.every(cl => cl.walletAddress === walletAddress)).toBe(true);
    });

    it('should return credit lines sorted by creation date (newest first)', async () => {
      const walletAddress = 'wallet-sort';

      const cl1 = await repository.create({ walletAddress, creditLimit: '1000.00', interestRateBps: 500 });
      // ensure different timestamps
      await new Promise((r) => setTimeout(r, 1));
      const cl2 = await repository.create({ walletAddress, creditLimit: '2000.00', interestRateBps: 600 });

      const results = await repository.findByWalletAddress(walletAddress);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(cl2);
      expect(results[1]).toEqual(cl1);
    });

    it('should use deterministic ordering when timestamps are equal', async () => {
      const walletAddress = 'wallet-equal-ts';

      const a = await repository.create({ walletAddress, creditLimit: '100.00', interestRateBps: 100 });
      const b = await repository.create({ walletAddress, creditLimit: '200.00', interestRateBps: 200 });

      const same = new Date('2026-01-01T00:00:00.000Z');
      repository['creditLines'].set(a.id, { ...a, createdAt: same });
      repository['creditLines'].set(b.id, { ...b, createdAt: same });

      const results = await repository.findByWalletAddress(walletAddress);
      const expectedOrder = [a.id, b.id].sort((x, y) => x.localeCompare(y));
      expect(results.slice(0, 2).map(r => r.id)).toEqual(expectedOrder);
    });

    it('should return empty array when no credit lines found', async () => {
      const creditLines = await repository.findByWalletAddress('nonexistent');
      expect(creditLines).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return all credit lines with pagination', async () => {
      // Create 5 credit lines
      for (let i = 0; i < 5; i++) {
        await repository.create({
          walletAddress: `wallet${i}`,
          creditLimit: '1000.00',
          interestRateBps: 500
        });
      }

      const all = await repository.findAll();
      expect(all).toHaveLength(5);

      const paginated = await repository.findAll(2, 2);
      expect(paginated).toHaveLength(2);
    });

    it('should return all credit lines sorted by creation date (newest first)', async () => {
      // Create 3 credit lines with slight delays
      const cls = [] as any[];
      for (let i = 0; i < 3; i++) {
        cls.push(await repository.create({ walletAddress: `w${i}`, creditLimit: '1000.00', interestRateBps: 500 }));
        await new Promise(r => setTimeout(r, 1));
      }

      const all = await repository.findAll();
      expect(all).toHaveLength(3);
      expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(all[1].createdAt.getTime());
    });

    it('should use deterministic ordering when timestamps are equal', async () => {
      const a = await repository.create({ walletAddress: 'x', creditLimit: '10.00', interestRateBps: 10 });
      const b = await repository.create({ walletAddress: 'y', creditLimit: '20.00', interestRateBps: 20 });

      const same = new Date('2026-01-01T00:00:00.000Z');
      repository['creditLines'].set(a.id, { ...a, createdAt: same });
      repository['creditLines'].set(b.id, { ...b, createdAt: same });

      const all = await repository.findAll();
      const expectedOrder = [a.id, b.id].sort((x, y) => x.localeCompare(y));
      expect(all.slice(0, 2).map(c => c.id)).toEqual(expectedOrder);
    });
  });

  describe('update', () => {
    it('should update credit line successfully', async () => {
      const created = await repository.create({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      // Add a small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1));

      const updateRequest = {
        creditLimit: '2000.00',
        interestRateBps: 600,
        status: CreditLineStatus.SUSPENDED
      };

      const updated = await repository.update(created.id, updateRequest);

      expect(updated).toBeDefined();
      expect(updated!.creditLimit).toBe('2000.00');
      expect(updated!.interestRateBps).toBe(600);
      expect(updated!.status).toBe(CreditLineStatus.SUSPENDED);
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it('should adjust available credit when credit limit changes', async () => {
      const created = await repository.create({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      // Simulate some credit being used
      await repository.update(created.id, { creditLimit: '1000.00' });
      const current = await repository.findById(created.id);
      // Manually set available credit to simulate usage
      current!.availableCredit = '500.00';
      repository['creditLines'].set(created.id, current!);

      // Update credit limit
      const updated = await repository.update(created.id, { creditLimit: '2000.00' });
      
      // Available credit should maintain the same ratio
      expect(updated!.availableCredit).toBe('1000');
    });

    it('should return null when credit line not found', async () => {
      const updated = await repository.update('nonexistent', { creditLimit: '2000.00' });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete credit line successfully', async () => {
      const created = await repository.create({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const deleted = await repository.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false when credit line not found', async () => {
      const deleted = await repository.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true when credit line exists', async () => {
      const created = await repository.create({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const exists = await repository.exists(created.id);
      expect(exists).toBe(true);
    });

    it('should return false when credit line does not exist', async () => {
      const exists = await repository.exists('nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('count', () => {
    it('should return correct count', async () => {
      expect(await repository.count()).toBe(0);

      await repository.create({
        walletAddress: 'wallet1',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      expect(await repository.count()).toBe(1);

      await repository.create({
        walletAddress: 'wallet2',
        creditLimit: '2000.00',
        interestRateBps: 600
      });

      expect(await repository.count()).toBe(2);
    });
  });
});