/**
 * Structured JSON logger for creditra-backend
 * Provides consistent logging format with correlation ID support
 */

export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
}

export interface LogContext {
    correlationId?: string;
    [key: string]: unknown;
}

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: LogContext;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

/**
 * Sensitive field patterns to redact from logs
 */
const SENSITIVE_PATTERNS = [
    /private[_-]?key/i,
    /secret/i,
    /password/i,
    /token/i,
    /api[_-]?key/i,
    /auth/i,
];

/**
 * Redacts sensitive data from log context
 */
export function sanitizeContext(context: LogContext): LogContext {
    const sanitized: LogContext = {};

    for (const [key, value] of Object.entries(context)) {
        const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

        if (isSensitive) {
            sanitized[key] = '[REDACTED]';
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            sanitized[key] = sanitizeContext(value as LogContext);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Logger class for structured JSON logging
 */
export class Logger {
    private minLevel: LogLevel;

    constructor(minLevel: LogLevel = LogLevel.INFO) {
        this.minLevel = minLevel;
    }

    private shouldLog(level: LogLevel): boolean {
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        return levels.indexOf(level) >= levels.indexOf(this.minLevel);
    }

    private formatLogEntry(
        level: LogLevel,
        message: string,
        context?: LogContext,
        error?: Error
    ): LogEntry {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };

        if (context) {
            entry.context = sanitizeContext(context);
        }

        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        }

        return entry;
    }

    private write(entry: LogEntry): void {
        const output = JSON.stringify(entry);

        if (entry.level === LogLevel.ERROR) {
            console.error(output);
        } else {
            console.log(output);
        }
    }

    debug(message: string, context?: LogContext): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            this.write(this.formatLogEntry(LogLevel.DEBUG, message, context));
        }
    }

    info(message: string, context?: LogContext): void {
        if (this.shouldLog(LogLevel.INFO)) {
            this.write(this.formatLogEntry(LogLevel.INFO, message, context));
        }
    }

    warn(message: string, context?: LogContext): void {
        if (this.shouldLog(LogLevel.WARN)) {
            this.write(this.formatLogEntry(LogLevel.WARN, message, context));
        }
    }

    error(message: string, context?: LogContext, error?: Error): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            this.write(this.formatLogEntry(LogLevel.ERROR, message, context, error));
        }
    }
}

/**
 * Default logger instance
 */
export const logger = new Logger(
    process.env.LOG_LEVEL as LogLevel ?? LogLevel.INFO
);
