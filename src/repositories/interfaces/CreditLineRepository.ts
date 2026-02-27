import { CreditLine, CreateCreditLineRequest, UpdateCreditLineRequest } from '../../models/CreditLine.js';

export interface CreditLineRepository {
  /**
   * Create a new credit line
   */
  create(request: CreateCreditLineRequest): Promise<CreditLine>;

  /**
   * Find credit line by ID
   */
  findById(id: string): Promise<CreditLine | null>;

  /**
   * Find credit lines by wallet address
   */
  findByWalletAddress(walletAddress: string): Promise<CreditLine[]>;

  /**
   * Get all credit lines with optional pagination
   */
  findAll(offset?: number, limit?: number): Promise<CreditLine[]>;

  /**
   * Update credit line
   */
  update(id: string, request: UpdateCreditLineRequest): Promise<CreditLine | null>;

  /**
   * Delete credit line
   */
  delete(id: string): Promise<boolean>;

  /**
   * Check if credit line exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Get total count of credit lines
   */
  count(): Promise<number>;
}