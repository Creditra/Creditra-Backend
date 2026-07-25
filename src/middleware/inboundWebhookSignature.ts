/**
 * Inbound webhook signature verification + replay protection.
 *
 * Partners must sign each delivery with HMAC-SHA256 and include:
 *   - `X-Timestamp`  — ISO-8601 or unix epoch seconds
 *   - `X-Nonce`      — unique id per message (replay key)
 *   - `X-Signature`  — `sha256=<hex>` over `timestamp.nonce.raw_body`
 *
 * See `docs/webhooks.md` for the partner-facing signing scheme.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getRawBody } from './rawBody.js';
import {
  defaultInboundWebhookNonceStore,
  type InboundWebhookNonceStore,
} from '../services/inboundWebhookNonceStore.js';

export const DEFAULT_INBOUND_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

const SIGNATURE_PREFIX = 'sha256=';
const HEX_64 = /^[a-fA-F0-9]{64}$/;

export interface InboundWebhookSignatureOptions {
  /** Shared HMAC secret. Defaults to `process.env.INBOUND_WEBHOOK_SECRET`. */
  secret?: string;
  /** Nonce claim store. Defaults to the process-local store. */
  nonceStore?: InboundWebhookNonceStore;
  /** Clock source (injectable for tests). */
  now?: () => number;
  /**
   * Max |now - timestamp| allowed. Defaults to
   * `INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS` or 5 minutes.
   */
  toleranceMs?: number;
}

/**
 * Build the partner-facing signature header value for a payload.
 * Exported for tests and partner SDK samples.
 */
export function signInboundWebhookPayload(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer | string,
): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.${nonce}.`);
  hmac.update(rawBody);
  return `${SIGNATURE_PREFIX}${hmac.digest('hex')}`;
}

/**
 * Parse `X-Timestamp` as ISO-8601 or unix epoch seconds.
 * Returns epoch ms, or `null` if unparseable.
 */
export function parseWebhookTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Unix epoch seconds (integer, optionally with fractional part).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (!Number.isFinite(asNumber)) return null;
    // Treat values < 1e12 as seconds; larger as milliseconds.
    return asNumber < 1e12 ? Math.floor(asNumber * 1000) : Math.floor(asNumber);
  }

  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0] ?? '';
  return typeof raw === 'string' ? raw : '';
}

function parseSignatureHex(header: string): Buffer | null {
  const value = header.trim();
  if (!value.toLowerCase().startsWith(SIGNATURE_PREFIX)) return null;
  const hex = value.slice(SIGNATURE_PREFIX.length).trim();
  if (!HEX_64.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function resolveToleranceMs(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  const fromEnv = process.env.INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_INBOUND_WEBHOOK_TOLERANCE_MS;
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: message });
}

/**
 * Factory for the inbound webhook verification middleware.
 *
 * Order of checks (fail closed):
 * 1. Secret configured (else 503)
 * 2. Required headers present and well-formed
 * 3. Timestamp within tolerance
 * 4. HMAC matches (constant time)
 * 5. Nonce not previously claimed (replay)
 */
export function createInboundWebhookSignatureMiddleware(
  options: InboundWebhookSignatureOptions = {},
) {
  const nonceStore = options.nonceStore ?? defaultInboundWebhookNonceStore;
  const now = options.now ?? (() => Date.now());
  const toleranceMs = resolveToleranceMs(options.toleranceMs);

  return function inboundWebhookSignature(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const secret = options.secret ?? process.env.INBOUND_WEBHOOK_SECRET ?? '';
    if (!secret) {
      res.status(503).json({
        error: 'Inbound webhook signing is not configured on this server.',
      });
      return;
    }

    const timestamp = headerValue(req, 'x-timestamp');
    const nonce = headerValue(req, 'x-nonce');
    const signature = headerValue(req, 'x-signature');

    if (!timestamp || !nonce || !signature) {
      unauthorized(
        res,
        'Missing required webhook headers (X-Timestamp, X-Nonce, X-Signature)',
      );
      return;
    }

    if (nonce.length > 256) {
      unauthorized(res, 'Invalid webhook nonce');
      return;
    }

    const sentAtMs = parseWebhookTimestamp(timestamp);
    if (sentAtMs === null) {
      unauthorized(res, 'Invalid webhook timestamp');
      return;
    }

    const skew = Math.abs(now() - sentAtMs);
    if (skew > toleranceMs) {
      unauthorized(res, 'Stale webhook timestamp');
      return;
    }

    const rawBody = getRawBody(req);
    if (!rawBody) {
      unauthorized(res, 'Missing raw request body for signature verification');
      return;
    }

    const provided = parseSignatureHex(signature);
    if (!provided) {
      unauthorized(res, 'Malformed webhook signature');
      return;
    }

    const expectedHex = signInboundWebhookPayload(secret, timestamp, nonce, rawBody)
      .slice(SIGNATURE_PREFIX.length);
    const expected = Buffer.from(expectedHex, 'hex');

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      unauthorized(res, 'Invalid webhook signature');
      return;
    }

    // Claim only after cryptographic verification so attackers cannot poison
    // the nonce cache with unsigned traffic.
    const expiresAtMs = Math.max(now(), sentAtMs) + toleranceMs;
    if (!nonceStore.claim(nonce, expiresAtMs)) {
      unauthorized(res, 'Replay detected');
      return;
    }

    next();
  };
}
