import { type CreditLine, type CreateCreditLineRequest, type UpdateCreditLineRequest, CreditLineStatus } from '../../models/CreditLine.js';
import type { CreditLineRepository } from '../interfaces/CreditLineRepository.js';
import type { DbClient } from '../../db/client.js';

interface BorrowerRow {
  id: string;
  wallet_address: string;
  created_at: Date;
  updated_at: Date;
}

interface CreditLineRow {
  id: string;
  borrower_id: string;
  credit_limit: string;
  currency: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  wallet_address?: string; // From JOIN
}

export class PostgresCreditLineRepository implements CreditLineRepository {
  constructor(private client: DbClient) {}

  async create(request: CreateCreditLineRequest): Promise<CreditLine> {
    // First, ensure borrower exists or create one
    const borrowerId = await this.ensureBorrower(request.walletAddress);
    
    // Create credit line
    const query = `
      INSERT INTO credit_lines (borrower_id, credit_limit, currency, status)
      VALUES ($1, $2, $3, $4)
      RETURNING id, borrower_id, credit_limit, currency, status, created_at, updated_at
    `;
    
    const values = [
      borrowerId,
      request.creditLimit,
      'USDC', // Default currency - could be made configurable
      CreditLineStatus.ACTIVE
    ];

    const result = await this.client.query(query, values);
    const row = result.rows[0] as CreditLineRow;

    return this.mapRowToCreditLine(row, request.walletAddress, request.interestRateBps);
  }

  async findById(id: string): Promise<CreditLine | null> {
    const query = `
      SELECT 
        cl.id, cl.borrower_id, cl.credit_limit, cl.currency, cl.status, 
        cl.created_at, cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      WHERE cl.id = $1
    `;

    const result = await this.client.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as CreditLineRow;
    return this.mapRowToCreditLine(row, row.wallet_address!);
  }

  async findByWalletAddress(walletAddress: string): Promise<CreditLine[]> {
    const query = `
      SELECT 
        cl.id, cl.borrower_id, cl.credit_limit, cl.currency, cl.status, 
        cl.created_at, cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      WHERE b.wallet_address = $1
      ORDER BY cl.created_at DESC
    `;

    const result = await this.client.query(query, [walletAddress]);
    
    return result.rows.map((row) => 
      this.mapRowToCreditLine(row as CreditLineRow, walletAddress)
    );
  }

  async findAll(offset = 0, limit = 100): Promise<CreditLine[]> {
    const query = `
      SELECT 
        cl.id, cl.borrower_id, cl.credit_limit, cl.currency, cl.status, 
        cl.created_at, cl.updated_at,
        b.wallet_address
      FROM credit_lines cl
      JOIN borrowers b ON cl.borrower_id = b.id
      ORDER BY cl.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.client.query(query, [limit, offset]);
    
    return result.rows.map((row) => {
      const typedRow = row as CreditLineRow;
      return this.mapRowToCreditLine(typedRow, typedRow.wallet_address!);
    });
  }

  async update(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null> {
    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (request.creditLimit !== undefined) {
      updates.push(`credit_limit = $${paramCount++}`);
      values.push(request.creditLimit);
    }

    if (request.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(request.status);
    }

    if (updates.length === 0) {
      // No updates to make, return current record
      return this.findById(id);
    }

    updates.push(`updated_at = now()`);
    values.push(id); // For WHERE clause

    const query = `
      UPDATE credit_lines 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, borrower_id, credit_limit, currency, status, created_at, updated_at
    `;

    const result = await this.client.query(query, values);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as CreditLineRow;
    
    // Get wallet address
    const walletQuery = `
      SELECT wallet_address FROM borrowers WHERE id = $1
    `;
    const walletResult = await this.client.query(walletQuery, [row.borrower_id]);
    const walletAddress = (walletResult.rows[0] as BorrowerRow).wallet_address;

    return this.mapRowToCreditLine(row, walletAddress);
  }

  async delete(id: string): Promise<boolean> {
    const query = `DELETE FROM credit_lines WHERE id = $1`;
    const result = await this.client.query(query, [id]);
    return (result as { rowCount: number }).rowCount > 0;
  }

  async exists(id: string): Promise<boolean> {
    const query = `SELECT 1 FROM credit_lines WHERE id = $1`;
    const result = await this.client.query(query, [id]);
    return result.rows.length > 0;
  }

  async count(): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM credit_lines`;
    const result = await this.client.query(query);
    return parseInt((result.rows[0] as { count: string }).count, 10);
  }

  /**
   * Ensure borrower exists for the given wallet address, create if not exists
   */
  private async ensureBorrower(walletAddress: string): Promise<string> {
    // Try to find existing borrower
    const findQuery = `SELECT id FROM borrowers WHERE wallet_address = $1`;
    const findResult = await this.client.query(findQuery, [walletAddress]);
    
    if (findResult.rows.length > 0) {
      return (findResult.rows[0] as BorrowerRow).id;
    }

    // Create new borrower
    const createQuery = `
      INSERT INTO borrowers (wallet_address)
      VALUES ($1)
      RETURNING id
    `;
    const createResult = await this.client.query(createQuery, [walletAddress]);
    return (createResult.rows[0] as BorrowerRow).id;
  }

  /**
   * Calculate available credit based on transactions
   */
  private async calculateAvailableCredit(creditLineId: string, creditLimit: string): Promise<string> {
    const query = `
      SELECT COALESCE(SUM(
        CASE 
          WHEN type = 'draw' THEN amount
          WHEN type = 'repayment' THEN -amount
          ELSE 0
        END
      ), 0) as used_credit
      FROM transactions 
      WHERE credit_line_id = $1
    `;
    
    const result = await this.client.query(query, [creditLineId]);
    const usedCredit = parseFloat((result.rows[0] as { used_credit: string }).used_credit || '0');
    const limit = parseFloat(creditLimit);
    
    return Math.max(0, limit - usedCredit).toString();
  }

  /**
   * Map database row to CreditLine model
   */
  private mapRowToCreditLine(
    row: CreditLineRow, 
    walletAddress: string, 
    interestRateBps?: number
  ): CreditLine {
    return {
      id: row.id,
      walletAddress,
      creditLimit: row.credit_limit,
      availableCredit: row.credit_limit, // TODO: Calculate from transactions
      interestRateBps: interestRateBps || 500, // Default 5% - should be stored in DB
      status: row.status as CreditLineStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}