/**
 * src/lib/logger.ts
 *
 * Structured JSON logging utility for Creditra Backend.
 *
 * Exports:
 *  - REDACTED_FIELDS   – default set of field names that must never appear in logs
 *  - redactObject      – recursively redacts sensitive keys from any object
 *  - createLogger      – factory that returns { info, warn, error } bound to a context label
 */

// ---------------------------------------------------------------------------
// Sensitive-field registry
// ---------------------------------------------------------------------------

/** Fields whose values are always replaced with '[REDACTED]' in log output. */
export const REDACTED_FIELDS: readonly string[] = [
    'authorization',
    'x-api-key',
    'password',
    'token',
    'secret',
    'ssn',
    'creditCardNumber',
    'cvv',
    'privateKey',
];

// ---------------------------------------------------------------------------
// Redaction helper
// ---------------------------------------------------------------------------

/**
 * Deep-clone `obj` and replace the value of any key whose lowercase form
 * matches an entry in `fields` with the string `'[REDACTED]'`.
 *
 * Handles nested objects and arrays.  Non-object primitives are returned
 * unchanged.  The original value is never mutated.
 */
export function redactObject(
    obj: unknown,
    fields: readonly string[] = REDACTED_FIELDS,
): unknown {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map((item) => redactObject(item, fields));
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            if (fields.some((f) => f.toLowerCase() === key.toLowerCase())) {
                result[key] = '[REDACTED]';
            } else {
                result[key] = redactObject(value, fields);
            }
        }
        return result;
    }

    return obj; // primitive – string, number, boolean, etc.
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    ts: string;
    level: LogLevel;
    context: string;
    requestId?: string;
    message: string;
    [key: string]: unknown;
}

export interface Logger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Create a logger bound to `context` (e.g. `'risk-router'`).
 *
 * - `info` / `warn` write JSON to **stdout**
 * - `error` writes JSON to **stderr**
 *
 * Pass `{ requestId }` in `meta` to associate a log line with a specific
 * HTTP request.
 */
export function createLogger(context: string): Logger {
    function write(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
        const entry: LogEntry = {
            ts: new Date().toISOString(),
            level,
            context,
            message,
            ...meta,
        };

        const line = JSON.stringify(entry);

        if (level === 'error') {
            process.stderr.write(line + '\n');
        } else {
            process.stdout.write(line + '\n');
        }
    }

    return {
        info: (message, meta) => write('info', message, meta),
        warn: (message, meta) => write('warn', message, meta),
        error: (message, meta) => write('error', message, meta),
    };
}
