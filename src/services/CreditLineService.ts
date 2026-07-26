import { type CreditLine, type CreateCreditLineRequest, type UpdateCreditLineRequest, CreditLineStatus } from '../models/CreditLine.js';
import type { CreditLineRepository, CursorPaginationResult } from '../repositories/interfaces/CreditLineRepository.js';
import type { TransactionRepository } from '../repositories/interfaces/TransactionRepository.js';
import { TransactionType } from '../models/Transaction.js';
import {
  passthroughTransactionRunner,
  type TransactionRunner,
} from '../db/transaction.js';
import type { EventBus } from './events/eventBus.js';
import { nowIso } from './events/domainEvents.js';

/**
 * Optional dependencies that enable atomic multi-table credit mutations.
 *
 * - `transactionRepository` — ledger writes paired with draw/repay
 * - `runInTransaction` — BEGIN/COMMIT/ROLLBACK boundary (Postgres) or passthrough
 *   (in-memory). See `docs/transactions.md`.
 */
export interface CreditLineServiceDeps {
  transactionRepository?: TransactionRepository;
  runInTransaction?: TransactionRunner;
}

/**
 * Domain service for credit-line CRUD plus the `draw` / `repay` operations.
 *
 * Depends on the {@link CreditLineRepository} interface, not on a concrete
 * Postgres or in-memory implementation — the {@link Container} picks the
 * implementation at boot based on `DATABASE_URL` + `NODE_ENV`.
 *
 * Invariants enforced here, *before* the repository call:
 * - `walletAddress` is required on create
 * - `creditLimit` must parse to a positive decimal
 * - `interestRateBps` is clamped to the basis-points range `0..10000`
 * - Pagination `limit` is clamped to `1..100`; `offset` must be `≥ 0`
 *
 * **Transaction boundaries.** Mutating methods that touch more than one
 * persistence step (`createCreditLine`, `draw`, `repay`) run inside
 * {@link TransactionRunner} so a mid-flow failure rolls back every write.
 * Domain events are emitted *after* the transaction commits so subscribers
 * never observe state that was rolled back.
 *
 * Errors are thrown as plain {@link Error} with human-readable messages so
 * the route layer can map them to the `{ data, error }` response envelope.
 *
 * See `docs/ARCHITECTURE.md` §2 (request lifecycle), `docs/transactions.md`,
 * and `docs/API.md` for the surfaces that call into this service.
 */
export class CreditLineService {
  private readonly transactionRepository?: TransactionRepository;
  private readonly runInTransaction: TransactionRunner;

  /**
   * @param creditLineRepository persistence for credit lines
   * @param eventBus optional in-process bus; when supplied, lifecycle changes
   *   (open / draw / repay) publish domain events for decoupled subscribers
   *   (audit, webhooks, notifications). Emission is fire-and-forget and never
   *   blocks or fails the core operation.
   * @param deps optional ledger + transaction-boundary wiring
   */
  constructor(
    private creditLineRepository: CreditLineRepository,
    private readonly eventBus?: EventBus,
    deps: CreditLineServiceDeps = {},
  ) {
    this.transactionRepository = deps.transactionRepository;
    this.runInTransaction = deps.runInTransaction ?? passthroughTransactionRunner;
  }

  /** Publish a domain event without letting subscriber failures affect callers. */
  private emit(event: Parameters<EventBus['publish']>[0]): void {
    if (!this.eventBus) return;
    void this.eventBus.publish(event);
  }

  /**
   * Create a new credit line for `walletAddress` with an explicit credit limit
   * and (optional) interest rate.
   *
   * Runs inside a transaction so multi-statement repository paths
   * (e.g. ensure-borrower + insert credit line on Postgres) cannot leave a
   * partial row set if a later statement fails.
   *
   * @throws if `walletAddress` is empty, `creditLimit` ≤ 0, or
   * `interestRateBps` is outside `0..10000`.
   */
  async createCreditLine(request: CreateCreditLineRequest): Promise<CreditLine> {
    // Validate request (pure; outside the transaction)
    if (!request.walletAddress) {
      throw new Error('Wallet address is required');
    }

    if (!request.creditLimit || parseFloat(request.creditLimit) <= 0) {
      throw new Error('Credit limit must be greater than 0');
    }

    if (request.interestRateBps < 0 || request.interestRateBps > 10000) {
      throw new Error('Interest rate must be between 0 and 10000 basis points');
    }

    const created = await this.runInTransaction(async () => {
      return this.creditLineRepository.create(request);
    });

    this.emit({
      type: 'credit.opened',
      occurredAt: nowIso(),
      creditLineId: created.id,
      payload: { walletAddress: created.walletAddress, creditLimit: created.creditLimit },
    });

    return created;
  }

  /** Fetch a single credit line by id, or `null` if not found. */
  async getCreditLine(id: string): Promise<CreditLine | null> {
    return await this.creditLineRepository.findById(id);
  }

  /** List every credit line owned by `walletAddress` (may be empty). */
  async getCreditLinesByWallet(walletAddress: string): Promise<CreditLine[]> {
    return await this.creditLineRepository.findByWalletAddress(walletAddress);
  }

  /**
   * Offset-pagination list of credit lines.
   *
   * @param offset zero-based row offset, must be `≥ 0`
   * @param limit page size, clamped to `1..100`
   */
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

  /**
   * Cursor-pagination list — preferred for large datasets because the cursor
   * is stable against concurrent inserts. The cursor is an opaque string
   * minted by the repository; clients pass `nextCursor` back unchanged.
   *
   * @see `docs/cursor-pagination.md`
   */
  async getAllCreditLinesWithCursor(cursor?: string, limit?: number): Promise<CursorPaginationResult> {
    if (limit !== undefined && limit <= 0) {
      throw new Error('Limit must be greater than 0');
    }
    if (limit !== undefined && limit > 100) {
      throw new Error('Limit cannot exceed 100');
    }
    return await this.creditLineRepository.findAllWithCursor(cursor, limit);
  }

  /**
   * Patch credit-line fields (`creditLimit`, `interestRateBps`, `status`).
   *
   * Validates limit/rate bounds before delegating to the repository. Returns
   * `null` if `id` does not exist — the route layer maps that to `404`.
   */
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

  /** Hard-delete a credit line. Returns `false` if `id` did not exist. */
  async deleteCreditLine(id: string): Promise<boolean> {
    return await this.creditLineRepository.delete(id);
  }

  /** Total credit-line row count — used for paging headers. */
  async getCreditLineCount(): Promise<number> {
    return await this.creditLineRepository.count();
  }

  /**
   * Deduct `amount` from the line's available credit.
   *
   * Enforced rules:
   * - line must exist (otherwise throws "Credit line not found")
   * - `borrowerId` (wallet address) must match `line.walletAddress` (otherwise throws "Unauthorized")
   * - line `status` must be {@link CreditLineStatus.ACTIVE}
   * - `utilized + amount` must not exceed `creditLimit`
   *
   * **Atomicity.** The balance update and the ledger row (`transactions` type
   * `borrow`) commit together. If either write fails, both roll back so the
   * off-chain mirror cannot desync from the ledger clients read.
   *
   * The on-chain transaction is submitted separately by the caller's wallet
   * or integration; confirmation flows back through the indexer.
   */
  async draw(id: string, borrowerId: string, amount: string): Promise<CreditLine> {
    // Pre-flight read + pure validation outside the write transaction so we
    // do not open a DB txn for cheap authorization failures.
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

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Draw amount must be greater than 0');
    }

    if (utilizedNum + amountNum > limitNum) {
      throw new Error('Credit limit exceeded');
    }

    this.emit({
      type: 'credit.draw_requested',
      occurredAt: nowIso(),
      creditLineId: id,
      payload: { walletAddress: line.walletAddress, amount },
    });

    const newUtilized = (utilizedNum + amountNum).toString();

    const updated = await this.runInTransaction(async () => {
      // Ledger first so Postgres available-credit (SUM of borrows/repays) is
      // consistent before we re-read the line after the balance touch.
      if (this.transactionRepository) {
        await this.transactionRepository.create({
          creditLineId: id,
          amount,
          type: TransactionType.BORROW,
        });
      }

      const next = await this.creditLineRepository.update(id, {
        utilized: newUtilized,
      });
      if (!next) {
        throw new Error('Credit line not found');
      }
      return next;
    });

    this.emit({
      type: 'credit.draw_confirmed',
      occurredAt: nowIso(),
      creditLineId: id,
      payload: { walletAddress: line.walletAddress, amount, utilized: updated.utilized },
    });

    return updated;
  }

  /**
   * Restore `amount` of available credit by reducing the line's `utilized`
   * balance. The utilized amount is floored at `0` so a stray overpayment
   * can never produce negative utilization on the persisted row.
   *
   * **Atomicity.** Balance update and ledger row (`transactions` type
   * `repay`) commit in one transaction — same guarantees as {@link draw}.
   *
   * Like {@link draw}, this method only manipulates the off-chain mirror of
   * state. The on-chain repay transaction is broadcast separately and
   * confirmed by the indexer.
   */
  async repay(id: string, _walletAddress: string, amount: string): Promise<CreditLine> {
    const line = await this.creditLineRepository.findById(id);
    if (!line) {
      throw new Error('Credit line not found');
    }

    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Repay amount must be greater than 0');
    }

    const utilizedNum = parseFloat(line.utilized || '0');
    const newUtilized = Math.max(0, utilizedNum - amountNum).toString();

    const updated = await this.runInTransaction(async () => {
      if (this.transactionRepository) {
        await this.transactionRepository.create({
          creditLineId: id,
          amount,
          type: TransactionType.REPAY,
        });
      }

      const next = await this.creditLineRepository.update(id, {
        utilized: newUtilized,
      });
      if (!next) {
        throw new Error('Credit line not found');
      }
      return next;
    });

    this.emit({
      type: 'credit.repay_confirmed',
      occurredAt: nowIso(),
      creditLineId: id,
      payload: { walletAddress: line.walletAddress, amount, utilized: updated.utilized },
    });

    return updated;
  }
}
