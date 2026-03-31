/**
 * Credit Reconciliation Service
 * 
 * Compares on-chain Credit contract records with CreditLineService database rows
 * and flags drift between the two sources of truth.
 */

import type { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';
import type { JobQueue } from './jobQueue.js';

export interface OnChainCreditRecord {
  /** Contract-level credit line identifier */
  id: string;
  /** Wallet address from the contract */
  walletAddress: string;
  /** Credit limit from the contract (as string for precision) */
  creditLimit: string;
  /** Available credit from the contract */
  availableCredit: string;
  /** Interest rate in basis points */
  interestRateBps: number;
  /** Contract status */
  status: string;
}

export interface ReconciliationMismatch {
  creditLineId: string;
  walletAddress: string;
  field: string;
  dbValue: string | number;
  chainValue: string | number;
  severity: 'critical' | 'warning';
}

export interface ReconciliationResult {
  timestamp: Date;
  totalChecked: number;
  mismatches: ReconciliationMismatch[];
  errors: string[];
}

export interface SorobanRpcClient {
  /**
   * Fetch all credit records from the on-chain contract.
   * In production, this would call the Soroban RPC endpoint.
   */
  fetchAllCreditRecords(): Promise<OnChainCreditRecord[]>;
}

export class ReconciliationService {
  constructor(
    private creditLineRepository: CreditLineRepository,
    private sorobanClient: SorobanRpcClient,
    private jobQueue: JobQueue,
  ) {}

  /**
   * Schedule a reconciliation job to run asynchronously.
   */
  scheduleReconciliation(delayMs = 0): string {
    return this.jobQueue.enqueue(
      'credit-reconciliation',
      {},
      { delayMs, maxAttempts: 3 }
    );
  }

  /**
   * Perform reconciliation: compare DB records with on-chain records.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      timestamp: new Date(),
      totalChecked: 0,
      mismatches: [],
      errors: [],
    };

    try {
      // Fetch all credit lines from database
      const dbCreditLines = await this.creditLineRepository.findAll(0, 10000);
      
      // Fetch all credit records from on-chain contract
      const chainRecords = await this.sorobanClient.fetchAllCreditRecords();

      // Create lookup maps
      const dbMap = new Map(dbCreditLines.map(cl => [cl.id, cl]));
      const chainMap = new Map(chainRecords.map(cr => [cr.id, cr]));

      result.totalChecked = Math.max(dbCreditLines.length, chainRecords.length);

      // Check for records in DB but not on chain
      for (const dbLine of dbCreditLines) {
        const chainRecord = chainMap.get(dbLine.id);
        
        if (!chainRecord) {
          result.mismatches.push({
            creditLineId: dbLine.id,
            walletAddress: dbLine.walletAddress,
            field: 'existence',
            dbValue: 'exists',
            chainValue: 'missing',
            severity: 'critical',
          });
          continue;
        }

        // Compare fields
        this.compareFields(dbLine, chainRecord, result.mismatches);
      }

      // Check for records on chain but not in DB
      for (const chainRecord of chainRecords) {
        if (!dbMap.has(chainRecord.id)) {
          result.mismatches.push({
            creditLineId: chainRecord.id,
            walletAddress: chainRecord.walletAddress,
            field: 'existence',
            dbValue: 'missing',
            chainValue: 'exists',
            severity: 'critical',
          });
        }
      }

      // Log results
      if (result.mismatches.length > 0) {
        console.error(
          `[ReconciliationService] Found ${result.mismatches.length} mismatches:`,
          JSON.stringify(result.mismatches, null, 2)
        );
      } else {
        console.log(
          `[ReconciliationService] Reconciliation complete. ${result.totalChecked} records checked, no mismatches found.`
        );
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);
      console.error('[ReconciliationService] Reconciliation failed:', error);
    }

    return result;
  }

  private compareFields(
    dbLine: { id: string; walletAddress: string; creditLimit: string; availableCredit: string; interestRateBps: number; status: string },
    chainRecord: OnChainCreditRecord,
    mismatches: ReconciliationMismatch[]
  ): void {
    // Compare wallet address
    if (dbLine.walletAddress !== chainRecord.walletAddress) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'walletAddress',
        dbValue: dbLine.walletAddress,
        chainValue: chainRecord.walletAddress,
        severity: 'critical',
      });
    }

    // Compare credit limit
    if (dbLine.creditLimit !== chainRecord.creditLimit) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'creditLimit',
        dbValue: dbLine.creditLimit,
        chainValue: chainRecord.creditLimit,
        severity: 'critical',
      });
    }

    // Compare available credit
    if (dbLine.availableCredit !== chainRecord.availableCredit) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'availableCredit',
        dbValue: dbLine.availableCredit,
        chainValue: chainRecord.availableCredit,
        severity: 'warning',
      });
    }

    // Compare interest rate
    if (dbLine.interestRateBps !== chainRecord.interestRateBps) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'interestRateBps',
        dbValue: dbLine.interestRateBps,
        chainValue: chainRecord.interestRateBps,
        severity: 'warning',
      });
    }

    // Compare status
    if (dbLine.status !== chainRecord.status) {
      mismatches.push({
        creditLineId: dbLine.id,
        walletAddress: dbLine.walletAddress,
        field: 'status',
        dbValue: dbLine.status,
        chainValue: chainRecord.status,
        severity: 'critical',
      });
    }
  }
}
