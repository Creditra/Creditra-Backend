const STELLAR_ADDRESS_REGEX = /\bG[A-Z2-7]{55}\b/g;

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isLogRedactionDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env['LOG_REDACTION_DEBUG'];
  if (!flag) {
    return false;
  }

  const normalized = flag.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

export function redactLogString(
  value: string,
  debugEnabled = isLogRedactionDebugEnabled(),
): string {
  if (debugEnabled) {
    return value;
  }

  return value.replace(STELLAR_ADDRESS_REGEX, truncateAddress);
}

function redactValueInternal(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return redactLogString(value, false);
  }

  if (value instanceof Error) {
    const redactedError = new Error(redactLogString(value.message, false));
    redactedError.name = value.name;
    if (value.stack) {
      redactedError.stack = redactLogString(value.stack, false);
    }

    const extra = value as unknown as Record<string, unknown>;
    for (const [key, nested] of Object.entries(extra)) {
      (redactedError as unknown as Record<string, unknown>)[key] =
        redactValueInternal(nested, seen);
    }

    return redactedError;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValueInternal(entry, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return value;
    }

    seen.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      redacted[key] = redactValueInternal(nested, seen);
    }

    return redacted;
  }

  return value;
}

export function redactLogValue<T>(
  value: T,
  debugEnabled = isLogRedactionDebugEnabled(),
): T {
  if (debugEnabled) {
    return value;
  }

  return redactValueInternal(value, new WeakSet<object>()) as T;
}

export function redactLogArgs(
  args: unknown[],
  debugEnabled = isLogRedactionDebugEnabled(),
): unknown[] {
  if (debugEnabled) {
    return args;
  }

  return args.map((arg) => redactLogValue(arg, false));
}
