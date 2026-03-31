import { describe, it, expect, vi } from 'vitest';
import {
  submitDrawRequest,
  submitRepayRequest,
  noopSorobanClient,
} from '../../src/services/creditService.js';
import type { SorobanClient } from '../../src/services/creditService.js';

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

describe('submitDrawRequest', () => {
  it('returns pending status when soroban client returns null', async () => {
    const result = await submitDrawRequest('line-1', {
      walletAddress: VALID_ADDRESS,
      amount: '100',
    });
    expect(result.id).toBe('line-1');
    expect(result.walletAddress).toBe(VALID_ADDRESS);
    expect(result.amount).toBe('100');
    expect(result.txHash).toBeNull();
    expect(result.status).toBe('pending');
  });

  it('returns submitted status when soroban client returns a tx hash', async () => {
    const mockClient: SorobanClient = {
      submitDraw: vi.fn().mockResolvedValue('tx-hash-abc'),
      submitRepay: vi.fn().mockResolvedValue(null),
    };
    const result = await submitDrawRequest(
      'line-1',
      { walletAddress: VALID_ADDRESS, amount: '100' },
      mockClient,
    );
    expect(result.txHash).toBe('tx-hash-abc');
    expect(result.status).toBe('submitted');
    expect(mockClient.submitDraw).toHaveBeenCalledWith(VALID_ADDRESS, 'line-1', '100');
  });

  it('propagates errors thrown by the soroban client', async () => {
    const mockClient: SorobanClient = {
      submitDraw: vi.fn().mockRejectedValue(new Error('network error')),
      submitRepay: vi.fn().mockResolvedValue(null),
    };
    await expect(
      submitDrawRequest('line-1', { walletAddress: VALID_ADDRESS, amount: '100' }, mockClient),
    ).rejects.toThrow('network error');
  });
});

describe('submitRepayRequest', () => {
  it('returns pending status when soroban client returns null', async () => {
    const result = await submitRepayRequest('line-1', {
      walletAddress: VALID_ADDRESS,
      amount: '50',
    });
    expect(result.id).toBe('line-1');
    expect(result.walletAddress).toBe(VALID_ADDRESS);
    expect(result.amount).toBe('50');
    expect(result.txHash).toBeNull();
    expect(result.status).toBe('pending');
  });

  it('returns submitted status when soroban client returns a tx hash', async () => {
    const mockClient: SorobanClient = {
      submitDraw: vi.fn().mockResolvedValue(null),
      submitRepay: vi.fn().mockResolvedValue('tx-hash-xyz'),
    };
    const result = await submitRepayRequest(
      'line-1',
      { walletAddress: VALID_ADDRESS, amount: '50' },
      mockClient,
    );
    expect(result.txHash).toBe('tx-hash-xyz');
    expect(result.status).toBe('submitted');
    expect(mockClient.submitRepay).toHaveBeenCalledWith(VALID_ADDRESS, 'line-1', '50');
  });

  it('propagates errors thrown by the soroban client', async () => {
    const mockClient: SorobanClient = {
      submitDraw: vi.fn().mockResolvedValue(null),
      submitRepay: vi.fn().mockRejectedValue(new Error('soroban error')),
    };
    await expect(
      submitRepayRequest('line-1', { walletAddress: VALID_ADDRESS, amount: '50' }, mockClient),
    ).rejects.toThrow('soroban error');
  });
});

describe('noopSorobanClient', () => {
  it('submitDraw returns null', async () => {
    const result = await noopSorobanClient.submitDraw(VALID_ADDRESS, 'line-1', '100');
    expect(result).toBeNull();
  });

  it('submitRepay returns null', async () => {
    const result = await noopSorobanClient.submitRepay(VALID_ADDRESS, 'line-1', '50');
    expect(result).toBeNull();
  });
});
