import { StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createSorobanClient,
  MockSorobanClient,
  parseEnumeratedCreditLinesScVal,
  resolveSorobanConfig,
  SorobanCreditRecordDecodeError,
  StellarSorobanClient,
} from '../sorobanClient.js';

const TEST_PUBLIC_KEY = `G${'A'.repeat(55)}`;
const TEST_SECRET_KEY = `S${'C'.repeat(55)}`;
const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TEST_CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  contractId: TEST_CONTRACT_ID,
  networkPassphrase: 'Test SDF Network ; September 2015',
};
const TEST_RPC_CONFIG = {
  rpcUrl: TEST_CONFIG.rpcUrl,
  networkPassphrase: TEST_CONFIG.networkPassphrase,
  timeoutMs: 50,
  maxRetries: 0,
  retryJitterMs: 0,
};

function pageXdr(value: unknown): string {
  return nativeToScVal(value).toXDR('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'failed' });
}

describe('resolveSorobanConfig', () => {
  it('uses documented defaults when env vars are absent', () => {
    const previousEnv = { ...process.env };
    delete process.env['SOROBAN_RPC_URL'];
    delete process.env['CREDIT_CONTRACT_ID'];
    delete process.env['STELLAR_NETWORK_PASSPHRASE'];

    try {
      expect(resolveSorobanConfig()).toEqual({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: '',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });
    } finally {
      process.env = previousEnv;
    }
  });
});

describe('createSorobanClient', () => {
  it('falls back to MockSorobanClient when CREDIT_CONTRACT_ID is empty', () => {
    expect(createSorobanClient({ ...TEST_CONFIG, contractId: '   ' }, TEST_RPC_CONFIG)).toBeInstanceOf(
      MockSorobanClient,
    );
  });

  it('selects StellarSorobanClient when CREDIT_CONTRACT_ID is set', () => {
    expect(createSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG)).toBeInstanceOf(StellarSorobanClient);
  });
});

describe('MockSorobanClient', () => {
  it('returns an empty record set for local and test environments', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(new MockSorobanClient({ ...TEST_CONFIG, contractId: '' }).fetchAllCreditRecords()).resolves.toEqual(
        [],
      );
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('CREDIT_CONTRACT_ID is empty'), {
        rpcUrl: TEST_CONFIG.rpcUrl,
      });
    } finally {
      consoleLog.mockRestore();
    }
  });
});

describe('StellarSorobanClient', () => {
  it('simulates enumerate_credit_lines and decodes the contract-native page shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          results: [
            {
              xdr: pageXdr([
                [
                  0,
                  {
                    borrower: TEST_PUBLIC_KEY,
                    credit_limit: '10000.0000000',
                    utilized_amount: '2500.0000000',
                    interest_rate_bps: 425,
                    status: 'Active',
                  },
                ],
              ]),
            },
          ],
        },
      }),
    );
    const client = new StellarSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG, fetchImpl as unknown as typeof fetch, {
      sleep: vi.fn().mockResolvedValue(undefined),
      random: () => 0,
    });

    await expect(client.fetchAllCreditRecords()).resolves.toEqual([
      {
        id: '0',
        walletAddress: TEST_PUBLIC_KEY,
        creditLimit: '10000.0000000',
        availableCredit: '7500.0000000',
        interestRateBps: 425,
        status: 'active',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      method: 'simulateTransaction',
    });
  });

  it('rejects invalid contract ids before posting RPC', async () => {
    const fetchImpl = vi.fn();
    const client = new StellarSorobanClient(
      { ...TEST_CONFIG, contractId: 'CINVALID' },
      TEST_RPC_CONFIG,
      fetchImpl as unknown as typeof fetch,
    );

    await expect(client.fetchAllCreditRecords()).rejects.toThrow('Invalid CREDIT_CONTRACT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redacts Stellar public and secret keys from thrown error strings', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: `failed for ${TEST_PUBLIC_KEY} using ${TEST_SECRET_KEY}` }));
    const client = new StellarSorobanClient(TEST_CONFIG, TEST_RPC_CONFIG, fetchImpl as unknown as typeof fetch);

    await expect(client.fetchAllCreditRecords()).rejects.toThrow('[REDACTED_STELLAR_PUBLIC_KEY]');
    await expect(client.fetchAllCreditRecords()).rejects.toThrow('[REDACTED_STELLAR_SECRET_KEY]');
  });
});

describe('parseEnumeratedCreditLinesScVal', () => {
  it('maps CreditLineData fields and computes availableCredit from utilized_amount', () => {
    expect(
      parseEnumeratedCreditLinesScVal(
        nativeToScVal([
          [
            7,
            {
              borrower: TEST_PUBLIC_KEY,
              credit_limit: '999999999999999999.0000001',
              utilized_amount: '0.0000001',
              interest_rate_bps: 700,
              status: { tag: 'Suspended' },
            },
          ],
        ]),
      ),
    ).toEqual([
      {
        id: '7',
        walletAddress: TEST_PUBLIC_KEY,
        creditLimit: '999999999999999999.0000001',
        availableCredit: '999999999999999999.0000000',
        interestRateBps: 700,
        status: 'suspended',
      },
    ]);
  });

  it('accepts tuple CreditLineData in contract field order', () => {
    expect(
      parseEnumeratedCreditLinesScVal(nativeToScVal([[1, [TEST_PUBLIC_KEY, 1000n, 250n, 300, 70, 0]]])),
    ).toEqual([
      {
        id: '1',
        walletAddress: TEST_PUBLIC_KEY,
        creditLimit: '1000',
        availableCredit: '750',
        interestRateBps: 300,
        status: 'active',
      },
    ]);
  });

  it('rejects duplicate borrowers instead of letting reconciliation hide them', () => {
    expect(() =>
      parseEnumeratedCreditLinesScVal(
        nativeToScVal([
          [0, [TEST_PUBLIC_KEY, 1000n, 0n, 300, 70, 'Active']],
          [1, [TEST_PUBLIC_KEY, 2000n, 0n, 300, 70, 'Active']],
        ]),
      ),
    ).toThrow(SorobanCreditRecordDecodeError);
  });
});
