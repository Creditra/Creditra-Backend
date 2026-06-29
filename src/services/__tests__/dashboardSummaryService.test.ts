import { describe, it, expect, vi } from 'vitest';
import { DashboardSummaryService } from '../dashboardSummaryService.js';
import { CreditLineStatus, type CreditLine } from '../../models/CreditLine.js';
import type { CreditLineRepository } from '../../repositories/interfaces/CreditLineRepository.js';

function line(partial: Partial<CreditLine>): CreditLine {
  return {
    id: 'cl',
    walletAddress: 'GW',
    creditLimit: '1000.00',
    availableCredit: '1000.00',
    utilized: '0',
    interestRateBps: 500,
    status: CreditLineStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function repoOf(lines: CreditLine[], findAll = vi.fn(async () => lines)): {
  repo: CreditLineRepository;
  findAll: typeof findAll;
} {
  const repo = { findAll } as unknown as CreditLineRepository;
  return { repo, findAll };
}

describe('DashboardSummaryService.aggregate', () => {
  it('computes totals and per-status counts', () => {
    const lines = [
      line({ id: 'a', creditLimit: '1000.00', utilized: '250.00', status: CreditLineStatus.ACTIVE }),
      line({ id: 'b', creditLimit: '500.00', utilized: '500.00', status: CreditLineStatus.SUSPENDED }),
      line({ id: 'c', creditLimit: '2000.00', utilized: '0', status: CreditLineStatus.ACTIVE }),
    ];

    const summary = DashboardSummaryService.aggregate(lines, '2026-01-01T00:00:00.000Z');

    expect(summary.totalCreditLines).toBe(3);
    expect(summary.totalCreditLimit).toBe('3500.00');
    expect(summary.totalUtilized).toBe('750.00');
    expect(summary.totalAvailable).toBe('2750.00');
    expect(summary.countsByStatus[CreditLineStatus.ACTIVE]).toBe(2);
    expect(summary.countsByStatus[CreditLineStatus.SUSPENDED]).toBe(1);
  });

  it('never reports negative available credit', () => {
    const summary = DashboardSummaryService.aggregate(
      [line({ creditLimit: '100.00', utilized: '150.00' })],
      'now',
    );
    expect(summary.totalAvailable).toBe('0.00');
  });
});

describe('DashboardSummaryService caching', () => {
  it('serves from cache within the TTL (single repo read)', async () => {
    let now = 0;
    const { repo, findAll } = repoOf([line({})]);
    const service = new DashboardSummaryService(repo, 30_000, () => now);

    await service.getSummary();
    now = 29_999;
    await service.getSummary();

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(service.isFresh()).toBe(true);
  });

  it('recomputes after the TTL elapses (staleness window upper bound)', async () => {
    let now = 0;
    const { repo, findAll } = repoOf([line({})]);
    const service = new DashboardSummaryService(repo, 30_000, () => now);

    await service.getSummary();
    now = 30_001; // beyond TTL
    await service.getSummary();

    expect(findAll).toHaveBeenCalledTimes(2);
  });

  it('recomputes immediately after invalidate()', async () => {
    let now = 0;
    const { repo, findAll } = repoOf([line({})]);
    const service = new DashboardSummaryService(repo, 30_000, () => now);

    await service.getSummary();
    service.invalidate();
    expect(service.isFresh()).toBe(false);
    await service.getSummary();

    expect(findAll).toHaveBeenCalledTimes(2);
  });
});
