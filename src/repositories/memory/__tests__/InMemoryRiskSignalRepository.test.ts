import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRiskSignalRepository } from '../InMemoryRiskSignalRepository.js';

describe('InMemoryRiskSignalRepository', () => {
  let repo: InMemoryRiskSignalRepository;

  beforeEach(() => {
    repo = new InMemoryRiskSignalRepository();
  });

  it('creates and retrieves a signal by id', async () => {
    const created = await repo.create({
      signalType: 'rapid_successive_draws',
      ruleId: 'rule.rapid_successive_draws',
      severity: 'medium',
      walletAddress: 'GTEST',
      creditLineId: 'line-1',
      correlationId: 'corr-1',
      thresholds: { minCount: 3 },
      evidence: { drawCount: 3 },
    });

    expect(created.id).toBeTruthy();
    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found?.correlationId).toBe('corr-1');
    expect(found?.status).toBe('open');
  });

  it('filters by signal type and wallet', async () => {
    await repo.create({
      signalType: 'draw_burst',
      ruleId: 'rule.draw_burst',
      severity: 'high',
      walletAddress: 'W1',
      creditLineId: 'L1',
      correlationId: 'c1',
      thresholds: {},
      evidence: {},
    });
    await repo.create({
      signalType: 'rapid_successive_draws',
      ruleId: 'rule.rapid_successive_draws',
      severity: 'medium',
      walletAddress: 'W2',
      creditLineId: 'L2',
      correlationId: 'c2',
      thresholds: {},
      evidence: {},
    });

    const bursts = await repo.findMany({ signalType: 'draw_burst' });
    expect(bursts).toHaveLength(1);
    expect(bursts[0].walletAddress).toBe('W1');

    const w2 = await repo.findMany({ walletAddress: 'W2' });
    expect(w2).toHaveLength(1);
    expect(await repo.count({ walletAddress: 'W2' })).toBe(1);
  });
});
