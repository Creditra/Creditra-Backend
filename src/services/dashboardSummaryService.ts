/**
 * Cached read model for dashboard queries.
 *
 * Dashboard widgets (total credit lines, aggregate limit / utilized /
 * available, per-status counts) are read-heavy and tolerant of brief
 * staleness. Computing them on every request scans the whole credit-line set,
 * which does not scale. This service materializes those aggregates into an
 * in-memory summary and serves it from cache.
 *
 * ## Staleness guarantees
 *  - The cache is served for at most `ttlMs` (default 30s). After the TTL the
 *    next read recomputes from the source repository. Therefore a reader never
 *    observes data older than `ttlMs` — the documented staleness window.
 *  - Mutations that change the aggregates SHOULD call {@link invalidate} so the
 *    next read recomputes immediately (correct, not merely fresh-within-window).
 *
 * This is a lightweight, in-process materialization. A production deployment
 * could swap the compute step for a `SELECT … GROUP BY` against a summary
 * table / materialized view without changing this contract.
 */
import type { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';
import { CreditLineStatus, type CreditLine } from '../models/CreditLine.js';

/** Materialized dashboard summary. All money fields are decimal strings. */
export interface DashboardSummary {
  readonly totalCreditLines: number;
  readonly totalCreditLimit: string;
  readonly totalUtilized: string;
  readonly totalAvailable: string;
  readonly countsByStatus: Readonly<Record<CreditLineStatus, number>>;
  /** When this summary snapshot was computed. */
  readonly generatedAt: string;
}

const DEFAULT_TTL_MS = 30_000;

export class DashboardSummaryService {
  private cache?: { summary: DashboardSummary; expiresAt: number };

  constructor(
    private readonly creditLineRepository: CreditLineRepository,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Return the dashboard summary, served from cache when fresh (within the
   * `ttlMs` staleness window) and recomputed otherwise.
   */
  async getSummary(): Promise<DashboardSummary> {
    const nowMs = this.now();
    if (this.cache && nowMs < this.cache.expiresAt) {
      return this.cache.summary;
    }
    const summary = await this.computeSummary();
    this.cache = { summary, expiresAt: nowMs + this.ttlMs };
    return summary;
  }

  /**
   * Drop the cached summary so the next {@link getSummary} recomputes. Call
   * after any mutation that affects the aggregates (create/draw/repay/status).
   */
  invalidate(): void {
    this.cache = undefined;
  }

  /** True when a cached summary is present and still within its TTL. */
  isFresh(): boolean {
    return this.cache !== undefined && this.now() < this.cache.expiresAt;
  }

  private async computeSummary(): Promise<DashboardSummary> {
    const lines = await this.creditLineRepository.findAll();
    return DashboardSummaryService.aggregate(lines, new Date(this.now()).toISOString());
  }

  /** Pure aggregation — extracted so it is trivially unit-testable. */
  static aggregate(lines: CreditLine[], generatedAt: string): DashboardSummary {
    const countsByStatus: Record<CreditLineStatus, number> = {
      [CreditLineStatus.ACTIVE]: 0,
      [CreditLineStatus.SUSPENDED]: 0,
      [CreditLineStatus.CLOSED]: 0,
      [CreditLineStatus.PENDING]: 0,
    };

    let totalLimit = 0;
    let totalUtilized = 0;

    for (const line of lines) {
      countsByStatus[line.status] = (countsByStatus[line.status] ?? 0) + 1;
      totalLimit += parseFloat(line.creditLimit) || 0;
      totalUtilized += parseFloat(line.utilized || '0') || 0;
    }

    const totalAvailable = Math.max(0, totalLimit - totalUtilized);

    return {
      totalCreditLines: lines.length,
      totalCreditLimit: totalLimit.toFixed(2),
      totalUtilized: totalUtilized.toFixed(2),
      totalAvailable: totalAvailable.toFixed(2),
      countsByStatus,
      generatedAt,
    };
  }
}
