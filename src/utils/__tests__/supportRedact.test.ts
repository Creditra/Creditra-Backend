import { describe, it, expect } from 'vitest';
import {
  truncateWalletAddress,
  redactSupportString,
  redactSupportValue,
} from '../supportRedact.js';

const WALLET = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK';
const SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('supportRedact', () => {
  it('truncates wallet addresses for display', () => {
    expect(truncateWalletAddress(WALLET)).toBe('GDRXE2...NLRK');
  });

  it('redacts seeds, emails, and embedded wallets in free-form strings', () => {
    const input = `wallet=${WALLET} seed=${SECRET} contact=ops@example.com`;
    const out = redactSupportString(input);
    expect(out).not.toContain(WALLET);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('ops@example.com');
    expect(out).toContain('[REDACTED_STELLAR_SECRET]');
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).toContain('GDRXE2...NLRK');
  });

  it('deep-redacts walletAddress fields and sensitive keys', () => {
    const payload = {
      walletAddress: WALLET,
      creditLimit: '1000.00',
      secret: 'should-never-leak',
      nested: {
        borrowerWallet: WALLET,
        api_key: 'ck_secret',
      },
      recentTransactions: [
        { walletAddress: WALLET, amount: '10.00', type: 'borrow' },
      ],
    };

    const redacted = redactSupportValue(payload);
    expect(redacted.walletAddress).toBe('GDRXE2...NLRK');
    expect(redacted.creditLimit).toBe('1000.00');
    expect(redacted.secret).toBe('[REDACTED]');
    expect(redacted.nested.borrowerWallet).toBe('GDRXE2...NLRK');
    expect(redacted.nested.api_key).toBe('[REDACTED]');
    expect(redacted.recentTransactions[0].walletAddress).toBe('GDRXE2...NLRK');
    expect(redacted.recentTransactions[0].amount).toBe('10.00');
    expect(JSON.stringify(redacted)).not.toContain(WALLET);
    expect(JSON.stringify(redacted)).not.toContain('should-never-leak');
  });
});
