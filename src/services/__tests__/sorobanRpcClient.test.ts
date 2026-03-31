import {
  createSorobanRpcClient,
  resolveSorobanRpcConfig,
  SorobanRpcConfig,
  ContractReadResult,
  ContractSubmitResult,
} from '../sorobanRpcClient';

describe('SorobanRpcClient', () => {
  const mockConfig: SorobanRpcConfig = {
    rpcUrl: 'https://test-soroban.stellar.org',
    networkPassphrase: 'Test Network',
    timeoutMs: 5000,
    maxRetries: 2,
    retryJitterMs: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSorobanRpcClient', () => {
    it('should create a client with default configuration', () => {
      const client = createSorobanRpcClient(mockConfig);
      
      expect(client.rpcUrl).toBe(mockConfig.rpcUrl);
      expect(client.networkPassphrase).toBe(mockConfig.networkPassphrase);
    });

    it('should merge configuration with defaults', () => {
      const minimalConfig: SorobanRpcConfig = {
        rpcUrl: 'https://test.stellar.org',
        networkPassphrase: 'Test Net',
      };

      const client = createSorobanRpcClient(minimalConfig);
      
      expect(client.rpcUrl).toBe(minimalConfig.rpcUrl);
      expect(client.networkPassphrase).toBe(minimalConfig.networkPassphrase);
    });
  });

  describe('simulateContractRead', () => {
    it('should successfully read contract data', async () => {
      const client = createSorobanRpcClient(mockConfig);
      
      const result = await client.simulateContractRead(
        'contract-123',
        'get_value',
        ['arg1']
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.ledger).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should handle read errors gracefully', async () => {
      const client = createSorobanRpcClient(mockConfig);
      
      // Mock a failure scenario
      jest.spyOn(client as any, 'makeRpcCall').mockRejectedValueOnce(
        new Error('Contract not found')
      );

      const result = await client.simulateContractRead(
        'invalid-contract',
        'get_value'
      );

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Contract not found');
    });

    it('should sanitize private keys in error messages', async () => {
      const client = createSorobanRpcClient(mockConfig);
      
      const privateKeyError = new Error('Failed with private key SABK5Q5Z...');
      jest.spyOn(client as any, 'makeRpcCall').mockRejectedValueOnce(privateKeyError);

      const result = await client.simulateContractRead('contract-123', 'get_value');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed with private key [REDACTED_PRIVATE_KEY]');
    });
  });

  describe('submitTransaction', () => {
    it('should successfully submit transaction', async () => {
      const client = createSorobanRpcClient(mockConfig);
      const transactionXdr = 'AAAA...'; // Mock XDR

      const result = await client.submitTransaction(transactionXdr);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBeDefined();
      expect(result.transactionId).toMatch(/^[a-f0-9]{64}$/);
      expect(result.ledger).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should handle submission errors', async () => {
      const client = createSorobanRpcClient(mockConfig);
      const transactionXdr = 'INVALID_XDR';

      jest.spyOn(client as any, 'makeRpcCall').mockRejectedValueOnce(
        new Error('Invalid transaction XDR')
      );

      const result = await client.submitTransaction(transactionXdr);

      expect(result.success).toBe(false);
      expect(result.transactionId).toBeUndefined();
      expect(result.error).toBe('Invalid transaction XDR');
    });
  });

  describe('getCreditLine', () => {
    it('should fetch credit line data', async () => {
      const client = createSorobanRpcClient(mockConfig);

      const result = await client.getCreditLine('credit-contract-123');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        expect(result.data.id).toBe('credit-line-123');
        expect(result.data.borrower).toMatch(/^G[A-Z0-9]{55}$/);
        expect(result.data.limit).toBe('1000.0000000');
        expect(result.data.utilized).toBe('250.0000000');
        expect(result.data.status).toBe('Active');
        expect(result.data.interestRate).toBe('0.05');
        expect(result.data.createdAt).toBeDefined();
        expect(result.data.lastUpdated).toBeDefined();
      }
    });
  });

  describe('readContract', () => {
    it('should be a generic wrapper for simulateContractRead', async () => {
      const client = createSorobanRpcClient(mockConfig);

      const result = await client.readContract<{ value: string }>(
        'contract-123',
        'custom_method',
        ['param1', 'param2']
      );

      expect(result.success).toBe(true);
    });
  });

  describe('retry logic', () => {
    it('should retry on failure and eventually succeed', async () => {
      const client = createSorobanRpcClient({
        ...mockConfig,
        maxRetries: 2,
        retryJitterMs: 10, // Small jitter for faster tests
      });

      let attemptCount = 0;
      jest.spyOn(client as any, 'makeRpcCall').mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Temporary failure');
        }
        return { result: 'success', ledger: 12345 };
      });

      const result = await client.simulateContractRead('contract-123', 'get_value');

      expect(result.success).toBe(true);
      expect(attemptCount).toBe(2);
    });

    it('should exhaust retries and fail', async () => {
      const client = createSorobanRpcClient({
        ...mockConfig,
        maxRetries: 1,
        retryJitterMs: 10,
      });

      jest.spyOn(client as any, 'makeRpcCall').mockRejectedValue(
        new Error('Persistent failure')
      );

      const result = await client.simulateContractRead('contract-123', 'get_value');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Persistent failure');
    });
  });

  describe('parameter sanitization', () => {
    it('should not log private keys in parameters', async () => {
      const client = createSorobanRpcClient(mockConfig);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await client.simulateContractRead('contract-123', 'get_value', [
        { privateKey: 'SABK5Q5Z...' }
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Simulating RPC call: simulateTransaction'),
        expect.objectContaining({
          params: expect.objectContaining({
            args: expect.arrayContaining([
              expect.not.objectContaining({ privateKey: expect.any(String) })
            ])
          })
        })
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('resolveSorobanRpcConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should resolve configuration from environment variables', () => {
    process.env.SOROBAN_RPC_URL = 'https://custom-rpc.stellar.org';
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Custom Network';
    process.env.SOROBAN_TIMEOUT_MS = '60000';
    process.env.SOROBAN_MAX_RETRIES = '5';
    process.env.SOROBAN_RETRY_JITTER_MS = '2000';

    const config = resolveSorobanRpcConfig();

    expect(config.rpcUrl).toBe('https://custom-rpc.stellar.org');
    expect(config.networkPassphrase).toBe('Custom Network');
    expect(config.timeoutMs).toBe(60000);
    expect(config.maxRetries).toBe(5);
    expect(config.retryJitterMs).toBe(2000);
  });

  it('should use defaults when environment variables are not set', () => {
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    delete process.env.SOROBAN_TIMEOUT_MS;
    delete process.env.SOROBAN_MAX_RETRIES;
    delete process.env.SOROBAN_RETRY_JITTER_MS;

    const config = resolveSorobanRpcConfig();

    expect(config.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(config.timeoutMs).toBe(30000);
    expect(config.maxRetries).toBe(3);
    expect(config.retryJitterMs).toBe(1000);
  });
});
