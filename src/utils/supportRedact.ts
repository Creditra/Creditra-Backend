/**
 * Response-level redaction for support/troubleshooting payloads.
 *
 * Support endpoints intentionally return operational state for incident
 * response, but must not leak secrets or full PII in downstream logs,
 * screenshots, or ticket systems. Wallet addresses are truncated; Stellar
 * secret seeds and emails are fully redacted.
 *
 * This is separate from {@link redactLogValue} (log pipeline) so API
 * responses can keep structured troubleshooting fields while still masking
 * sensitive identifiers.
 */

const STELLAR_ADDRESS_REGEX = /\bG[A-Z2-7]{55}\b/g;
const STELLAR_SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/g;
const STELLAR_MUXED_ACCOUNT_REGEX = /\bM[A-Z2-7]{68}\b/g;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const SENSITIVE_KEY_PATTERN =
  /^(password|secret|seed|private[_-]?key|api[_-]?key|token|authorization)$/i;

/** Truncate a Stellar public key for safe display (keeps prefix/suffix for correlation). */
export function truncateWalletAddress(address: string): string {
  if (address.length < 12) {
    return '[REDACTED_WALLET]';
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Redact free-form strings that may embed addresses, seeds, or emails. */
export function redactSupportString(value: string): string {
  return value
    .replace(STELLAR_SECRET_SEED_REGEX, '[REDACTED_STELLAR_SECRET]')
    .replace(STELLAR_MUXED_ACCOUNT_REGEX, '[REDACTED_MUXED_ACCOUNT]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(STELLAR_ADDRESS_REGEX, (match) => truncateWalletAddress(match));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-redact a support payload. Known sensitive object keys are replaced
 * wholesale; string values are scrubbed for embedded secrets/addresses.
 */
export function redactSupportValue<T>(value: T): T {
  return redactInternal(value, new WeakSet<object>()) as T;
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactSupportString(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactInternal(entry, seen));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      // Wallet fields are common and get consistent truncation even when
      // already full-length addresses.
      if (
        (key === 'walletAddress' || key === 'borrowerWallet') &&
        typeof nested === 'string'
      ) {
        out[key] = truncateWalletAddress(nested);
        continue;
      }
      out[key] = redactInternal(nested, seen);
    }
    return out;
  }

  return value;
}
