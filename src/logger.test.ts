import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, sanitizeContext } from './logger.js';

describe('Logger', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('log levels', () => {
        it('should log info messages', () => {
            const logger = new Logger(LogLevel.INFO);
            logger.info('test message', { correlationId: '123' });

            expect(consoleLogSpy).toHaveBeenCalledOnce();
            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

            expect(logOutput.level).toBe('info');
            expect(logOutput.message).toBe('test message');
            expect(logOutput.context.correlationId).toBe('123');
            expect(logOutput.timestamp).toBeDefined();
        });

        it('should log error messages to console.error', () => {
            const logger = new Logger(LogLevel.INFO);
            const error = new Error('test error');
            logger.error('error occurred', { correlationId: '456' }, error);

            expect(consoleErrorSpy).toHaveBeenCalledOnce();
            const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);

            expect(logOutput.level).toBe('error');
            expect(logOutput.message).toBe('error occurred');
            expect(logOutput.context.correlationId).toBe('456');
            expect(logOutput.error.name).toBe('Error');
            expect(logOutput.error.message).toBe('test error');
            expect(logOutput.error.stack).toBeDefined();
        });

        it('should log warn messages', () => {
            const logger = new Logger(LogLevel.WARN);
            logger.warn('warning message');

            expect(consoleLogSpy).toHaveBeenCalledOnce();
            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

            expect(logOutput.level).toBe('warn');
            expect(logOutput.message).toBe('warning message');
        });

        it('should log debug messages when level is DEBUG', () => {
            const logger = new Logger(LogLevel.DEBUG);
            logger.debug('debug message');

            expect(consoleLogSpy).toHaveBeenCalledOnce();
            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);

            expect(logOutput.level).toBe('debug');
            expect(logOutput.message).toBe('debug message');
        });

        it('should not log debug messages when level is INFO', () => {
            const logger = new Logger(LogLevel.INFO);
            logger.debug('debug message');

            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('should not log info messages when level is WARN', () => {
            const logger = new Logger(LogLevel.WARN);
            logger.info('info message');

            expect(consoleLogSpy).not.toHaveBeenCalled();
        });
    });

    describe('log format', () => {
        it('should produce valid JSON output', () => {
            const logger = new Logger(LogLevel.INFO);
            logger.info('test', { key: 'value' });

            const output = consoleLogSpy.mock.calls[0][0];
            expect(() => JSON.parse(output)).not.toThrow();
        });

        it('should include timestamp in ISO format', () => {
            const logger = new Logger(LogLevel.INFO);
            logger.info('test');

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
            expect(logOutput.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('should handle messages without context', () => {
            const logger = new Logger(LogLevel.INFO);
            logger.info('simple message');

            const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
            expect(logOutput.message).toBe('simple message');
            expect(logOutput.context).toBeUndefined();
        });

        it('should handle errors without context', () => {
            const logger = new Logger(LogLevel.ERROR);
            const error = new Error('test');
            logger.error('error', undefined, error);

            const logOutput = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
            expect(logOutput.error).toBeDefined();
            expect(logOutput.context).toBeUndefined();
        });
    });

    describe('sanitizeContext', () => {
        it('should redact private keys', () => {
            const context = {
                privateKey: 'secret123',
                private_key: 'secret456',
                normalField: 'visible',
            };

            const sanitized = sanitizeContext(context);
            expect(sanitized.privateKey).toBe('[REDACTED]');
            expect(sanitized.private_key).toBe('[REDACTED]');
            expect(sanitized.normalField).toBe('visible');
        });

        it('should redact secrets', () => {
            const context = {
                secret: 'mysecret',
                apiSecret: 'apisecret',
                data: 'visible',
            };

            const sanitized = sanitizeContext(context);
            expect(sanitized.secret).toBe('[REDACTED]');
            expect(sanitized.apiSecret).toBe('[REDACTED]');
            expect(sanitized.data).toBe('visible');
        });

        it('should redact passwords', () => {
            const context = {
                password: 'pass123',
                userPassword: 'pass456',
            };

            const sanitized = sanitizeContext(context);
            expect(sanitized.password).toBe('[REDACTED]');
            expect(sanitized.userPassword).toBe('[REDACTED]');
        });

        it('should redact tokens', () => {
            const context = {
                token: 'token123',
                authToken: 'token456',
                apiKey: 'key789',
            };

            const sanitized = sanitizeContext(context);
            expect(sanitized.token).toBe('[REDACTED]');
            expect(sanitized.authToken).toBe('[REDACTED]');
            expect(sanitized.apiKey).toBe('[REDACTED]');
        });

        it('should handle nested objects', () => {
            const context = {
                user: {
                    name: 'John',
                    password: 'secret',
                },
                correlationId: '123',
            };

            const sanitized = sanitizeContext(context);
            expect((sanitized.user as any).name).toBe('John');
            expect((sanitized.user as any).password).toBe('[REDACTED]');
            expect(sanitized.correlationId).toBe('123');
        });

        it('should preserve arrays', () => {
            const context = {
                items: [1, 2, 3],
                privateKey: 'secret',
            };

            const sanitized = sanitizeContext(context);
            expect(sanitized.items).toEqual([1, 2, 3]);
            expect(sanitized.privateKey).toBe('[REDACTED]');
        });

        it('should handle empty context', () => {
            const sanitized = sanitizeContext({});
            expect(sanitized).toEqual({});
        });
    });
});
