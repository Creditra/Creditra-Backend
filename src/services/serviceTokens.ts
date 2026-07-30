/**
 * Signed JWT service tokens for internal service-to-service calls.
 *
 * Replaces long-lived shared API keys with short-lived (default 5 minute),
 * HMAC-SHA256 signed tokens carrying a service-account subject and a
 * structured permission list. No external JWT library is used — the format
 * is a minimal, dependency-free JWT (header.payload.signature, base64url,
 * HS256) so verification has no supply-chain surface beyond Node's `crypto`.
 *
 * ## Key rotation without downtime
 * Signing keys are held in an in-process registry keyed by `kid`. Rotating
 * adds a new signing key (used for all newly minted tokens) while previously
 * issued keys remain valid for verification until they age out of the
 * retention window — so tokens minted just before a rotation are not
 * invalidated mid-flight.
 *
 * ## Migration from shared API keys
 * `requireServiceToken` (see `../middleware/serviceAuth.js`) is additive: it
 * does not replace `createApiKeyMiddleware` on existing routes. Adopt it
 * route-by-route; both mechanisms can run side by side during the migration
 * window. See `docs/security/service-auth.md`.
 */
import * as crypto from 'node:crypto';

const ISSUER = 'creditra-backend';
const AUDIENCE = 'creditra-internal';
const DEFAULT_TTL_SECONDS = 300;
/** How many past signing keys remain valid for verification after a rotation. */
const KEY_RETENTION = 3;

export class ServiceTokenError extends Error {}

interface SigningKey {
  kid: string;
  secret: string;
}

class ServiceTokenKeyRegistry {
  /** Newest first; keys[0] is the current signing key. */
  private keys: SigningKey[] = [];

  constructor(initial: SigningKey) {
    this.keys.push(initial);
  }

  current(): SigningKey {
    const key = this.keys[0];
    if (!key) throw new ServiceTokenError('No signing key configured');
    return key;
  }

  getSecret(kid: string): string | undefined {
    return this.keys.find((k) => k.kid === kid)?.secret;
  }

  /** Add a new current signing key, retiring the oldest once past retention. */
  rotate(secret: string = crypto.randomBytes(32).toString('hex')): SigningKey {
    const key: SigningKey = { kid: crypto.randomUUID(), secret };
    this.keys.unshift(key);
    this.keys = this.keys.slice(0, KEY_RETENTION);
    return key;
  }
}

let registry: ServiceTokenKeyRegistry | undefined;

function getRegistry(): ServiceTokenKeyRegistry {
  if (!registry) {
    const secret = process.env.SERVICE_TOKEN_SECRET ?? crypto.randomBytes(32).toString('hex');
    registry = new ServiceTokenKeyRegistry({
      kid: process.env.SERVICE_TOKEN_KID ?? 'initial',
      secret,
    });
  }
  return registry;
}

/** Test-only hook to reset/inject a registry between cases. */
export function resetServiceTokenRegistry(): void {
  registry = undefined;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export interface ServiceTokenClaims {
  /** Service account name, e.g. "reconciliation-worker". */
  sub: string;
  permissions: string[];
}

export interface VerifiedServiceToken extends ServiceTokenClaims {
  kid: string;
}

/** Mint a short-lived signed service token. Returns the compact JWT string. */
export function mintServiceToken(
  claims: ServiceTokenClaims,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): { token: string; expiresAt: string } {
  const { kid, secret } = getRegistry().current();
  const header = { alg: 'HS256', typ: 'JWT', kid };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: claims.sub,
    permissions: claims.permissions,
    iat: now,
    exp,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return { token: `${signingInput}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verify a compact JWT service token. Throws {@link ServiceTokenError} on any failure. */
export function verifyServiceToken(token: string): VerifiedServiceToken {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ServiceTokenError('Malformed token');
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string;
    sub?: string;
    permissions?: unknown;
    exp?: number;
  };
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw new ServiceTokenError('Malformed token');
  }

  if (header.alg !== 'HS256' || !header.kid) {
    throw new ServiceTokenError('Unsupported or missing key id');
  }
  const secret = getRegistry().getSecret(header.kid);
  if (!secret) throw new ServiceTokenError('Unknown or expired signing key');

  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const actual = Buffer.from(signaturePart, 'base64url');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new ServiceTokenError('Invalid signature');
  }

  if (payload.iss !== ISSUER) throw new ServiceTokenError('Invalid issuer');
  if (payload.aud !== AUDIENCE) throw new ServiceTokenError('Invalid audience');
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new ServiceTokenError('Missing subject');
  }
  if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new ServiceTokenError('Token expired');
  }

  return {
    sub: payload.sub,
    permissions: Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [],
    kid: header.kid,
  };
}

/** Rotate the active signing key. Previously issued tokens remain verifiable. */
export function rotateServiceTokenKey(): { kid: string } {
  return { kid: getRegistry().rotate().kid };
}
