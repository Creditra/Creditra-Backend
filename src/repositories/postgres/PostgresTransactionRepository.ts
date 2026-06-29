import {
  type Transaction,
  type CreateTransactionRequest,
  TransactionStatus,
  TransactionType,
} from '../../models/Transaction.js';
import type { TransactionRepository } from '../interfaces/TransactionRepository.js';
import type { DbClient } from '../../db/client.js';

interface TransactionRow {
  id: string;
  credit_line_id: string;
  wallet_address: string;
  amount: string;
  type: string;
  status: string;
  blockchain_tx_hash: string | null;
  created_at: Date;
  processed_at: Date | null;
}

/**
 * Postgres-backed TransactionRepository.
 *
 * Maps the {@link Transaction} model onto the `transactions` table (see
 * `migrations/001_initial_schema.sql` + `004_repository_columns.sql`). The
 * `walletAddress` is resolved through `credit_lines -> borrowers`. All queries
 * are parameterized and the monetary `amount` column is preserved as `string`.
 */
export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private client: DbClient) {}

  async create(request: CreateTransactionRequest): Promise<Transaction> {
    const query = `
      INSERT INTO transactions (credit_line_id, type, amount, currency, status, blockchain_tx_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    const values = [
      request.creditLineId,
      request.type,
      request.amount,
      'USDC',
      TransactionStatus.PENDING,
      request.blockchainTxHash ?? null,
    ];
    const result = await this.client.query(query, values);
    const { id } = result.rows[0] as { id: string };
    const created = await this.findById(id);
    if (!created) {
      throw new Error(`Failed to load created transaction: ${id}`);
    }
    return created;
  }

  async findById(id: string): Promise<Transaction | null> {
    const rows = await this.select('WHERE t.id = $1', [id]);
    return rows[0] ?? null;
  }

  async findByCreditLineId(creditLineId: string, offset = 0, limit = 100): Promise<Transaction[]> {
    return this.select(
      'WHERE t.credit_line_id = $1',
      [creditLineId, limit, offset],
      'ORDER BY t.created_at DESC LIMIT $2 OFFSET $3'
    );
  }

  async findByWalletAddress(walletAddress: string, offset = 0, limit = 100): Promise<Transaction[]> {
    return this.select(
      'WHERE b.wallet_address = $1',
      [walletAddress, limit, offset],
      'ORDER BY t.created_at DESC LIMIT $2 OFFSET $3'
    );
  }

  async updateStatus(id: string, status: TransactionStatus, processedAt?: Date): Promise<Transaction | null> {
    const result = await this.client.query(
      'UPDATE transactions SET status = $1, processed_at = $2 WHERE id = $3 RETURNING id',
      [status, processedAt ?? new Date(), id]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.findById(id);
  }

  async findAll(offset = 0, limit = 100): Promise<Transaction[]> {
    return this.select('', [limit, offset], 'ORDER BY t.created_at DESC LIMIT $1 OFFSET $2');
  }

  async count(): Promise<number> {
    const result = await this.client.query('SELECT COUNT(*) as count FROM transactions');
    const row = result.rows[0] as { count: string };
    return parseInt(row.count, 10);
  }

  async findByStatus(status: TransactionStatus, offset = 0, limit = 100): Promise<Transaction[]> {
    return this.select(
      'WHERE t.status = $1',
      [status, limit, offset],
      'ORDER BY t.created_at DESC LIMIT $2 OFFSET $3'
    );
  }

  private async select(where: string, values: unknown[], tail = ''): Promise<Transaction[]> {
    const query = `
      SELECT t.id, t.credit_line_id, b.wallet_address, t.amount, t.type, t.status,
             t.blockchain_tx_hash, t.created_at, t.processed_at
      FROM transactions t
      JOIN credit_lines cl ON t.credit_line_id = cl.id
      JOIN borrowers b ON cl.borrower_id = b.id
      ${where}
      ${tail}
    `;
    const result = await this.client.query(query, values);
    return (result.rows as TransactionRow[]).map((row) => this.toModel(row));
  }

  private toModel(row: TransactionRow): Transaction {
    return {
      id: row.id,
      creditLineId: row.credit_line_id,
      walletAddress: row.wallet_address,
      amount: row.amount,
      type: row.type as TransactionType,
      status: row.status as TransactionStatus,
      blockchainTxHash: row.blockchain_tx_hash ?? undefined,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    };
  }
}
