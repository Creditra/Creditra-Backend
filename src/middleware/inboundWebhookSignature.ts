import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getRawBody } from './rawBody.js';
import {
  defaultInboundWebhookNonceStore,
  type InboundWebhookNonceStore,
} from '../services/inboundWebhookNonceStore.js';

const SIGNATURE_PREFIX = 'sha256=';
const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export interface InboundWebhookSignatureOptions {
  secret?: string;
  toleranceMs?: number;
  nonceStore?: InboundWebhookNonceStore;
  now?: () => number;
}

function readHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseSignature(header: string | undefined): Buffer | undefined {
  if (!header?.startsWith(SIGNATURE_PREFIX)) {
    return undefined;
  }
  const hex = header.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    return undefined;
  }
  return Buffer.from(hex, 'hex');
}

export function buildInboundWebhookSignaturePayload(
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from(`${timestamp}.${nonce}.`, 'utf8'),
    rawBody,
  ]);
}

export function signInboundWebhookPayload(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  const digest = createHmac('sha256', secret)
    .update(buildInboundWebhookSignaturePayload(timestamp, nonce, rawBody))
    .digest('hex');
  return `${SIGNATURE_PREFIX}${digest}`;
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ data: null, error: message });
}

export function createInboundWebhookSignatureMiddleware(
  options: InboundWebhookSignatureOptions = {},
) {
  const nonceStore = options.nonceStore ?? defaultInboundWebhookNonceStore;
  const now = options.now ?? (() => Date.now());

  return (req: Request, res: Response, next: NextFunction): void => {
    const secret = options.secret ?? process.env.INBOUND_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ data: null, error: 'Inbound webhook signing secret is not configured' });
      return;
    }

    const timestamp = readHeader(req, 'x-timestamp');
    const nonce = readHeader(req, 'x-nonce');
    const provided = parseSignature(readHeader(req, 'x-signature'));
    const rawBody = getRawBody(req);

    if (!timestamp || !nonce || !provided || !rawBody) {
      unauthorized(res, 'Missing or malformed webhook signature headers');
      return;
    }

    const sentAtMs = Date.parse(timestamp);
    const toleranceMs = options.toleranceMs ?? Number.parseInt(
      process.env.INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_MS ?? String(DEFAULT_TOLERANCE_MS),
      10,
    );
    if (!Number.isFinite(sentAtMs) || Math.abs(now() - sentAtMs) > toleranceMs) {
      unauthorized(res, 'Stale webhook timestamp');
      return;
    }

    const expected = parseSignature(signInboundWebhookPayload(secret, timestamp, nonce, rawBody));
    if (!expected || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      unauthorized(res, 'Invalid webhook signature');
      return;
    }

    if (!nonceStore.claim(nonce, sentAtMs + toleranceMs)) {
      unauthorized(res, 'Replay detected');
      return;
    }

    next();
  };
}
