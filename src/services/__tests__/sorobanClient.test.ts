import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockSorobanClient, resolveSorobanConfig } from '../sorobanClient.js';

describe('MockSorobanClient', () => {
  let client: MockSorobanClient;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    
    client = new MockSorobanClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CTEST123',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  describe('fetchAllCreditRecords()', () => {
    it('returns empty array in mock implementation', async () => {
      const records = await client.fetchAllCreditRecords();
      expect(records).toEqual([]);
    });

    it('logs fetch attempt with config details', async () => {
      await client.fetchAllCreditRecords();
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Fetching credit records')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('CTEST123')
      );
    });

    it('completes without throwing', async () => {
      await expect(client.fetchAllCreditRecords()).resolves.not.toThrow();
    });
  });
});

describe('resolveSorobanConfig()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default config when no env vars set', () => {
    delete process.env['SOROBAN_RPC_URL'];
    delete process.env['CREDIT_CONTRACT_ID'];
    delete process.env['STELLAR_NETWORK_PASSPHRASE'];

    const config = resolveSorobanConfig();

    expect(config.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(config.contractId).toBe('');
    expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('reads SOROBAN_RPC_URL from env', () => {
    process.env['SOROBAN_RPC_URL'] = 'https://custom-rpc.example.com';

    const config = resolveSorobanConfig();

    expect(config.rpcUrl).toBe('https://custom-rpc.example.com');
  });

  it('reads CREDIT_CONTRACT_ID from env', () => {
    process.env['CREDIT_CONTRACT_ID'] = 'CCONTRACT123';

    const config = resolveSorobanConfig();

    expect(config.contractId).toBe('CCONTRACT123');
  });

  it('reads STELLAR_NETWORK_PASSPHRASE from env', () => {
    process.env['STELLAR_NETWORK_PASSPHRASE'] = 'Public Global Stellar Network ; September 2015';

    const config = resolveSorobanConfig();

    expect(config.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
  });

  it('reads all config values from env simultaneously', () => {
    process.env['SOROBAN_RPC_URL'] = 'https://mainnet-rpc.stellar.org';
    process.env['CREDIT_CONTRACT_ID'] = 'CMAINNET456';
    process.env['STELLAR_NETWORK_PASSPHRASE'] = 'Public Global Stellar Network ; September 2015';

    const config = resolveSorobanConfig();

    expect(config).toEqual({
      rpcUrl: 'https://mainnet-rpc.stellar.org',
      contractId: 'CMAINNET456',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
  });
});
