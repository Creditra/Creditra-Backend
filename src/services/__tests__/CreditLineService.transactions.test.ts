/**
 * Transaction-boundary tests for credit mutations.
 *
 * Verifies that draw / repay / create run inside the injected TransactionRunner
 * and that a mid-flow failure aborts the whole unit of work (no partial
 * credit-line update + orphan ledger row).
 *
 * @see docs/transactions.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CreditLineService } from '../CreditLineService.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';
import type { TransactionRepository } from '../../repositories/interfaces/TransactionRepository.js';
import {
  type CreditLine,
  CreditLineStatus,
} from '../../models/CreditLine.js';
import {
  TransactionType,
  TransactionStatus,
  type Transaction,
  type CreateTransactionRequest,
} from '../../models/Transaction.js';
import type { TransactionRunner } from '../../db/transaction.js';
import type { DbClient } from '../../db/client.js';
import { createDbTransactionRunner } from '../../db/transaction.js';

const WALLET = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';

function baseLine(overrides: Partial<CreditLine> = {}): CreditLine {
  return {
    id: 'cl-1',
    walletAddress: WALLET,
    creditLimit: '1000',
    availableCredit: '1000',
    utilized: '0',
    interestRateBps: 500,
    status: CreditLineStatus.ACTIVE,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CreditLineService transaction boundaries', () => {
  let creditLines: CreditLineRepository;
  let transactions: TransactionRepository;
  let ledger: CreateTransactionRequest[];
  let utilizedStore: Map<string, string>;
  let lines: Map<string, CreditLine>;

  beforeEach(() => {
    ledger = [];
    utilizedStore = new Map();
    lines = new Map([['cl-1', baseLine()]]);

    creditLines = {
      create: vi.fn(async (req) => {
        const line = baseLine({
          id: 'cl-new',
          walletAddress: req.walletAddress,
          creditLimit: req.creditLimit,
          availableCredit: req.creditLimit,
          interestRateBps: req.interestRateBps,
        });
        lines.set(line.id, line);
        return line;
      }),
      findById: vi.fn(async (id) => {
        const line = lines.get(id);
        if (!line) return null;
        const utilized = utilizedStore.get(id) ?? line.utilized;
        const limit = parseFloat(line.creditLimit);
        const util = parseFloat(utilized);
        return {
          ...line,
          utilized,
          availableCredit: (limit - util).toString(),
        };
      }),
      findByWalletAddress: vi.fn(async () => []),
      findAll: vi.fn(async () => []),
      findAllWithCursor: vi.fn(async () => ({
        items: [],
        nextCursor: null,
        hasMore: false,
      })),
      update: vi.fn(async (id, request) => {
        const existing = lines.get(id);
        if (!existing) return null;
        if (request.utilized !== undefined) {
          utilizedStore.set(id, request.utilized);
        }
        const utilized = utilizedStore.get(id) ?? existing.utilized;
        const limit = parseFloat(
          request.creditLimit ?? existing.creditLimit,
        );
        const updated: CreditLine = {
          ...existing,
          ...request,
          utilized,
          availableCredit: (limit - parseFloat(utilized)).toString(),
          updatedAt: new Date(),
        };
        lines.set(id, updated);
        return updated;
      }),
      delete: vi.fn(async () => false),
      exists: vi.fn(async () => true),
      count: vi.fn(async () => lines.size),
    };

    transactions = {
      create: vi.fn(async (request: CreateTransactionRequest) => {
        ledger.push(request);
        const tx: Transaction = {
          id: `tx-${ledger.length}`,
          creditLineId: request.creditLineId,
          walletAddress: WALLET,
          amount: request.amount,
          type: request.type,
          status: TransactionStatus.PENDING,
          blockchainTxHash: request.blockchainTxHash,
          createdAt: new Date(),
        };
        return tx;
      }),
      findById: vi.fn(async () => null),
      findByCreditLineId: vi.fn(async () => []),
      findByWalletAddress: vi.fn(async () => []),
      updateStatus: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      count: vi.fn(async () => ledger.length),
      findByStatus: vi.fn(async () => []),
    };
  });

  it('draw updates utilized and records a borrow ledger row inside the runner', async () => {
    const runOrder: string[] = [];
    const runInTransaction: TransactionRunner = async (work) => {
      runOrder.push('begin');
      try {
        const result = await work();
        runOrder.push('commit');
        return result;
      } catch (e) {
        runOrder.push('rollback');
        throw e;
      }
    };

    const service = new CreditLineService(creditLines, undefined, {
      transactionRepository: transactions,
      runInTransaction,
    });

    const updated = await service.draw('cl-1', WALLET, '250');

    expect(updated.utilized).toBe('250');
    expect(ledger).toEqual([
      {
        creditLineId: 'cl-1',
        amount: '250',
        type: TransactionType.BORROW,
      },
    ]);
    expect(runOrder).toEqual(['begin', 'commit']);
    expect(transactions.create).toHaveBeenCalledOnce();
    expect(creditLines.update).toHaveBeenCalledOnce();
  });

  it('repay records a repay ledger row and reduces utilized atomically', async () => {
    lines.set('cl-1', baseLine({ utilized: '400', availableCredit: '600' }));
    utilizedStore.set('cl-1', '400');

    const service = new CreditLineService(creditLines, undefined, {
      transactionRepository: transactions,
      runInTransaction: async (work) => work(),
    });

    const updated = await service.repay('cl-1', WALLET, '150');

    expect(updated.utilized).toBe('250');
    expect(ledger).toEqual([
      {
        creditLineId: 'cl-1',
        amount: '150',
        type: TransactionType.REPAY,
      },
    ]);
  });

  it('rolls back credit-line update when ledger write fails mid-flow', async () => {
    // Simulate a transactional store: apply mutations to a draft, only
    // promote on successful commit. Failure leaves the durable maps untouched.
    let draftUtilized: Map<string, string> | null = null;
    let draftLedger: CreateTransactionRequest[] | null = null;

    const runInTransaction: TransactionRunner = async (work) => {
      draftUtilized = new Map(utilizedStore);
      draftLedger = [...ledger];
      try {
        const result = await work();
        // commit
        utilizedStore = draftUtilized!;
        ledger = draftLedger!;
        draftUtilized = null;
        draftLedger = null;
        return result;
      } catch (error) {
        // rollback — discard drafts
        draftUtilized = null;
        draftLedger = null;
        throw error;
      }
    };

    creditLines.update = vi.fn(async (id, request) => {
      if (!draftUtilized) {
        throw new Error('update outside transaction');
      }
      if (request.utilized !== undefined) {
        draftUtilized.set(id, request.utilized);
      }
      const existing = lines.get(id)!;
      const utilized = draftUtilized.get(id) ?? existing.utilized;
      return {
        ...existing,
        utilized,
        availableCredit: (
          parseFloat(existing.creditLimit) - parseFloat(utilized)
        ).toString(),
      };
    });

    transactions.create = vi.fn(async (request) => {
      if (!draftLedger) {
        throw new Error('create outside transaction');
      }
      // Fail after the would-be ledger append would have been staged —
      // inject failure *instead* of recording so commit never runs.
      throw new Error('ledger write failed');
      draftLedger.push(request);
    });

    const service = new CreditLineService(creditLines, undefined, {
      transactionRepository: transactions,
      runInTransaction,
    });

    await expect(service.draw('cl-1', WALLET, '100')).rejects.toThrow(
      'ledger write failed',
    );

    // Durable state unchanged
    expect(utilizedStore.size).toBe(0);
    expect(ledger).toEqual([]);
    const still = await creditLines.findById('cl-1');
    expect(still?.utilized).toBe('0');
  });

  it('rolls back ledger row when credit-line update fails mid-flow', async () => {
    let draftUtilized: Map<string, string> | null = null;
    let draftLedger: CreateTransactionRequest[] | null = null;

    const runInTransaction: TransactionRunner = async (work) => {
      draftUtilized = new Map(utilizedStore);
      draftLedger = [...ledger];
      try {
        const result = await work();
        utilizedStore = draftUtilized!;
        ledger = draftLedger!;
        draftUtilized = null;
        draftLedger = null;
        return result;
      } catch (error) {
        draftUtilized = null;
        draftLedger = null;
        throw error;
      }
    };

    transactions.create = vi.fn(async (request) => {
      draftLedger!.push(request);
      return {
        id: 'tx-tmp',
        creditLineId: request.creditLineId,
        walletAddress: WALLET,
        amount: request.amount,
        type: request.type,
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
      };
    });

    creditLines.update = vi.fn(async () => {
      throw new Error('balance update failed');
    });

    const service = new CreditLineService(creditLines, undefined, {
      transactionRepository: transactions,
      runInTransaction,
    });

    await expect(service.draw('cl-1', WALLET, '100')).rejects.toThrow(
      'balance update failed',
    );

    expect(ledger).toEqual([]);
    expect(utilizedStore.size).toBe(0);
  });

  it('createCreditLine runs repository.create inside the transaction runner', async () => {
    const calls: string[] = [];
    const runInTransaction: TransactionRunner = async (work) => {
      calls.push('begin');
      const result = await work();
      calls.push('commit');
      return result;
    };

    const service = new CreditLineService(creditLines, undefined, {
      runInTransaction,
    });

    await service.createCreditLine({
      walletAddress: WALLET,
      creditLimit: '500',
      interestRateBps: 100,
    });

    expect(calls).toEqual(['begin', 'commit']);
    expect(creditLines.create).toHaveBeenCalledOnce();
  });

  it('does not emit draw_confirmed when the mutation rolls back', async () => {
    const published: string[] = [];
    const eventBus = {
      publish: vi.fn(async (event: { type: string }) => {
        published.push(event.type);
      }),
      subscribe: vi.fn(),
    };

    const runInTransaction: TransactionRunner = async (work) => {
      try {
        return await work();
      } catch (e) {
        throw e;
      }
    };

    transactions.create = vi.fn(async () => {
      throw new Error('db down');
    });

    const service = new CreditLineService(creditLines, eventBus as never, {
      transactionRepository: transactions,
      runInTransaction,
    });

    await expect(service.draw('cl-1', WALLET, '50')).rejects.toThrow('db down');

    // requested is pre-txn (observability); confirmed must not fire after rollback
    expect(published).toContain('credit.draw_requested');
    expect(published).not.toContain('credit.draw_confirmed');
  });
});

describe('CreditLineService + createDbTransactionRunner (SQL control flow)', () => {
  it('issues BEGIN … COMMIT around a successful multi-write draw', async () => {
    const statements: string[] = [];
    const client: DbClient = {
      async query(text: string) {
        statements.push(text.trim().toUpperCase().split(/\s+/)[0] ?? text);
        return { rows: [{ id: 'x' }] };
      },
      async end() {
        /* no-op */
      },
    };

    const line = baseLine();
    const creditLines: CreditLineRepository = {
      create: vi.fn(),
      findById: vi.fn(async () => line),
      findByWalletAddress: vi.fn(),
      findAll: vi.fn(),
      findAllWithCursor: vi.fn(),
      update: vi.fn(async (_id, req) => ({
        ...line,
        utilized: req.utilized ?? line.utilized,
        availableCredit: (
          parseFloat(line.creditLimit) -
          parseFloat(req.utilized ?? line.utilized)
        ).toString(),
      })),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn(),
    };

    const transactions: TransactionRepository = {
      create: vi.fn(async (req) => ({
        id: 'tx-1',
        creditLineId: req.creditLineId,
        walletAddress: WALLET,
        amount: req.amount,
        type: req.type,
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
      })),
      findById: vi.fn(),
      findByCreditLineId: vi.fn(),
      findByWalletAddress: vi.fn(),
      updateStatus: vi.fn(),
      findAll: vi.fn(),
      count: vi.fn(),
      findByStatus: vi.fn(),
    };

    // Runner drives real BEGIN/COMMIT on the recording client; repos themselves
    // are mocked and do not talk to SQL — we only assert control statements.
    const runInTransaction = createDbTransactionRunner(client);
    const service = new CreditLineService(creditLines, undefined, {
      transactionRepository: transactions,
      runInTransaction,
    });

    await service.draw('cl-1', WALLET, '10');

    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
  });

  it('issues BEGIN … ROLLBACK when a mid-flow write throws', async () => {
    const statements: string[] = [];
    const client: DbClient = {
      async query(text: string) {
        statements.push(text.trim().toUpperCase().split(/\s+/)[0] ?? text);
        return { rows: [] };
      },
      async end() {
        /* no-op */
      },
    };

    const line = baseLine();
    const creditLines: CreditLineRepository = {
      create: vi.fn(),
      findById: vi.fn(async () => line),
      findByWalletAddress: vi.fn(),
      findAll: vi.fn(),
      findAllWithCursor: vi.fn(),
      update: vi.fn(async () => {
        throw new Error('injected mid-flow failure');
      }),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn(),
    };

    const transactions: TransactionRepository = {
      create: vi.fn(async (req) => ({
        id: 'tx-1',
        creditLineId: req.creditLineId,
        walletAddress: WALLET,
        amount: req.amount,
        type: req.type,
        status: TransactionStatus.PENDING,
        createdAt: new Date(),
      })),
      findById: vi.fn(),
      findByCreditLineId: vi.fn(),
      findByWalletAddress: vi.fn(),
      updateStatus: vi.fn(),
      findAll: vi.fn(),
      count: vi.fn(),
      findByStatus: vi.fn(),
    };

    const service = new CreditLineService(creditLines, undefined, {
      transactionRepository: transactions,
      runInTransaction: createDbTransactionRunner(client),
    });

    await expect(service.draw('cl-1', WALLET, '10')).rejects.toThrow(
      'injected mid-flow failure',
    );

    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });
});
