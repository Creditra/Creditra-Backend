import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresCreditLineRepository } from '../PostgresCreditLineRepository.js';
import { CreditLineStatus } from '../../../models/CreditLine.js';
import type { DbClient } from '../../../db/client.js';

// Mock database client
function createMockClient(): DbClient {
  const mockData = {
    borrowers: new Map<string, any>(),
    creditLines: new Map<string, any>(),
    transactions: new Map<string, any>(),
    nextId: 1
  };

  const generateId = () => `test-id-${mockData.nextId++}`;

  return {
    query: async (text: string, values: unknown[] = []) => {
      const sql = text.trim().toLowerCase();
      
      // Handle borrower operations
      if (sql.includes('insert into borrowers')) {
        const id = generateId();
        const walletAddress = values[0] as string;
        const borrower = {
          id,
          wallet_address: walletAddress,
          created_at: new Date(),
          updated_at: new Date()
        };
        mockData.borrowers.set(id, borrower);
        return { rows: [borrower] };
      }
      
      if (sql.includes('select id from borrowers where wallet_address')) {
        const walletAddress = values[0] as string;
        const borrower = Array.from(mockData.borrowers.values())
          .find(b => b.wallet_address === walletAddress);
        return { rows: borrower ? [borrower] : [] };
      }

      // Handle credit line operations
      if (sql.includes('insert into credit_lines')) {
        const id = generateId();
        const creditLine = {
          id,
          borrower_id: values[0],
          credit_limit: values[1],
          currency: values[2],
          status: values[3],
          created_at: new Date(),
          updated_at: new Date()
        };
        mockData.creditLines.set(id, creditLine);
        return { rows: [creditLine] };
      }

      if (sql.includes('select') && sql.includes('credit_lines cl') && sql.includes('join borrowers b')) {
        if (sql.includes('where cl.id')) {
          const id = values[0] as string;
          const creditLine = mockData.creditLines.get(id);
          if (!creditLine) return { rows: [] };
          
          const borrower = mockData.borrowers.get(creditLine.borrower_id);
          return { 
            rows: [{ 
              ...creditLine, 
              wallet_address: borrower?.wallet_address 
            }] 
          };
        }

        if (sql.includes('where b.wallet_address')) {
          const walletAddress = values[0] as string;
          const borrower = Array.from(mockData.borrowers.values())
            .find(b => b.wallet_address === walletAddress);
          
          if (!borrower) return { rows: [] };
          
          const creditLines = Array.from(mockData.creditLines.values())
            .filter(cl => cl.borrower_id === borrower.id)
            .map(cl => ({ ...cl, wallet_address: walletAddress }));
          
          return { rows: creditLines };
        }

        // findAll
        if (sql.includes('limit') && sql.includes('offset')) {
          const limit = values[0] as number;
          const offset = values[1] as number;
          
          const allCreditLines = Array.from(mockData.creditLines.values())
            .map(cl => {
              const borrower = mockData.borrowers.get(cl.borrower_id);
              return { ...cl, wallet_address: borrower?.wallet_address };
            })
            .slice(offset, offset + limit);
          
          return { rows: allCreditLines };
        }
      }

      if (sql.includes('update credit_lines')) {
        const id = values[values.length - 1] as string;
        const creditLine = mockData.creditLines.get(id);
        if (!creditLine) return { rows: [] };

        // Simple update logic - in real implementation would parse SET clause
        const updated = { 
          ...creditLine, 
          updated_at: new Date() 
        };
        
        // Update specific fields based on values
        if (values.length >= 2 && typeof values[0] === 'string') {
          updated.credit_limit = values[0];
        }
        if (values.length >= 3 && typeof values[1] === 'string') {
          updated.status = values[1];
        }
        
        mockData.creditLines.set(id, updated);
        return { rows: [updated] };
      }

      if (sql.includes('delete from credit_lines')) {
        const id = values[0] as string;
        const existed = mockData.creditLines.has(id);
        mockData.creditLines.delete(id);
        return { rowCount: existed ? 1 : 0 } as any;
      }

      if (sql.includes('select 1 from credit_lines where id')) {
        const id = values[0] as string;
        const exists = mockData.creditLines.has(id);
        return { rows: exists ? [{ '?column?': 1 }] : [] };
      }

      if (sql.includes('select count(*) as count from credit_lines')) {
        return { rows: [{ count: mockData.creditLines.size.toString() }] };
      }

      if (sql.includes('select wallet_address from borrowers where id')) {
        const id = values[0] as string;
        const borrower = mockData.borrowers.get(id);
        return { rows: borrower ? [{ wallet_address: borrower.wallet_address }] : [] };
      }

      // Default empty response
      return { rows: [] };
    },
    end: async () => {}
  };
}

describe('PostgresCreditLineRepository', () => {
  let repository: PostgresCreditLineRepository;
  let mockClient: DbClient;

  beforeEach(() => {
    mockClient = createMockClient();
    repository = new PostgresCreditLineRepository(mockClient);
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
      expect(creditLine.interestRateBps).toBe(request.interestRateBps);
      expect(creditLine.status).toBe(CreditLineStatus.ACTIVE);
      expect(creditLine.createdAt).toBeInstanceOf(Date);
      expect(creditLine.updatedAt).toBeInstanceOf(Date);
    });

    it('should reuse existing borrower', async () => {
      const walletAddress = 'wallet123';
      
      // Create first credit line
      await repository.create({
        walletAddress,
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      // Create second credit line for same wallet
      const creditLine2 = await repository.create({
        walletAddress,
        creditLimit: '2000.00',
        interestRateBps: 600
      });

      expect(creditLine2.walletAddress).toBe(walletAddress);
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

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.walletAddress).toBe(request.walletAddress);
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

    it('should return empty array when no credit lines found', async () => {
      const creditLines = await repository.findByWalletAddress('nonexistent');
      expect(creditLines).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return all credit lines with pagination', async () => {
      // Create 3 credit lines
      for (let i = 0; i < 3; i++) {
        await repository.create({
          walletAddress: `wallet${i}`,
          creditLimit: '1000.00',
          interestRateBps: 500
        });
      }

      const all = await repository.findAll(0, 10);
      expect(all).toHaveLength(3);

      const paginated = await repository.findAll(1, 2);
      expect(paginated).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('should update credit line successfully', async () => {
      const created = await repository.create({
        walletAddress: 'wallet123',
        creditLimit: '1000.00',
        interestRateBps: 500
      });

      const updateRequest = {
        creditLimit: '2000.00',
        status: CreditLineStatus.SUSPENDED
      };

      const updated = await repository.update(created.id, updateRequest);

      expect(updated).toBeDefined();
      expect(updated!.creditLimit).toBe('2000.00');
      expect(updated!.status).toBe(CreditLineStatus.SUSPENDED);
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