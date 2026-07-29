import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mintServiceToken,
  verifyServiceToken,
  rotateServiceTokenKey,
  resetServiceTokenRegistry,
  ServiceTokenError,
} from '../serviceTokens.js';

describe('service tokens', () => {
  beforeEach(() => {
    resetServiceTokenRegistry();
    vi.useRealTimers();
  });

  it('mints a token that verifies back to the same claims', () => {
    const { token } = mintServiceToken({ sub: 'reconciliation-worker', permissions: ['reconcile:run'] });
    const claims = verifyServiceToken(token);
    expect(claims.sub).toBe('reconciliation-worker');
    expect(claims.permissions).toEqual(['reconcile:run']);
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = mintServiceToken({ sub: 'svc-a', permissions: [] });
    resetServiceTokenRegistry();
    process.env.SERVICE_TOKEN_SECRET = 'a-completely-different-secret-value';
    expect(() => verifyServiceToken(token)).toThrow(ServiceTokenError);
    delete process.env.SERVICE_TOKEN_SECRET;
  });

  it('rejects a malformed token', () => {
    expect(() => verifyServiceToken('not-a-jwt')).toThrow(ServiceTokenError);
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    const { token } = mintServiceToken({ sub: 'svc-a', permissions: [] }, 30);
    vi.advanceTimersByTime(31_000);
    expect(() => verifyServiceToken(token)).toThrow(ServiceTokenError);
    vi.useRealTimers();
  });

  it('rotating the signing key keeps previously issued tokens valid', () => {
    const { token: before } = mintServiceToken({ sub: 'svc-a', permissions: [] });
    rotateServiceTokenKey();
    const { token: after } = mintServiceToken({ sub: 'svc-a', permissions: [] });

    expect(() => verifyServiceToken(before)).not.toThrow();
    expect(() => verifyServiceToken(after)).not.toThrow();
  });

  it('rotating past the retention window invalidates the oldest key', () => {
    const { token: gen1 } = mintServiceToken({ sub: 'svc-a', permissions: [] });
    rotateServiceTokenKey();
    rotateServiceTokenKey();
    rotateServiceTokenKey();

    expect(() => verifyServiceToken(gen1)).toThrow(ServiceTokenError);
  });
});
