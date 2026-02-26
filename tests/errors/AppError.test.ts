import { describe, it, expect } from 'vitest';
import {
    AppError,
    ErrorCode,
    validationError,
    notFoundError,
    authenticationError,
    authorizationError,
    internalError,
} from '../../src/errors/index.js';

/* ================================================================== */
/*  AppError class                                                     */
/* ================================================================== */
describe('AppError', () => {
    it('should be an instance of Error', () => {
        const err = new AppError('boom');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
    });

    it('should default to INTERNAL_ERROR / 500', () => {
        const err = new AppError('boom');
        expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(err.statusCode).toBe(500);
        expect(err.isOperational).toBe(true);
    });

    it('should set `name` to AppError', () => {
        expect(new AppError('x').name).toBe('AppError');
    });

    it('should accept a custom code and map to the correct HTTP status', () => {
        const err = new AppError('bad input', ErrorCode.VALIDATION_ERROR);
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('should carry optional details', () => {
        const details = { field: 'email', issue: 'invalid format' };
        const err = new AppError('invalid email', ErrorCode.VALIDATION_ERROR, details);
        expect(err.details).toEqual(details);
    });

    it('should allow isOperational = false for unexpected errors', () => {
        const err = new AppError('crash', ErrorCode.INTERNAL_ERROR, undefined, false);
        expect(err.isOperational).toBe(false);
    });

    it('should have a stack trace', () => {
        const err = new AppError('trace me');
        expect(err.stack).toBeDefined();
        expect(err.stack).toContain('trace me');
    });
});

/* ================================================================== */
/*  Factory helpers                                                    */
/* ================================================================== */
describe('Error factory helpers', () => {
    describe('validationError', () => {
        it('should create a 400 VALIDATION_ERROR', () => {
            const err = validationError('bad input');
            expect(err).toBeInstanceOf(AppError);
            expect(err.statusCode).toBe(400);
            expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
            expect(err.message).toBe('bad input');
        });

        it('should forward optional details', () => {
            const err = validationError('bad', { field: 'name' });
            expect(err.details).toEqual({ field: 'name' });
        });
    });

    describe('notFoundError', () => {
        it('should create a 404 NOT_FOUND with resource name only', () => {
            const err = notFoundError('User');
            expect(err.statusCode).toBe(404);
            expect(err.code).toBe(ErrorCode.NOT_FOUND);
            expect(err.message).toBe('User not found');
            expect(err.details).toEqual({ resource: 'User' });
        });

        it('should include id in message and details when provided', () => {
            const err = notFoundError('Credit line', '42');
            expect(err.message).toBe('Credit line with id "42" not found');
            expect(err.details).toEqual({ resource: 'Credit line', id: '42' });
        });
    });

    describe('authenticationError', () => {
        it('should create a 401 AUTHENTICATION_ERROR with default message', () => {
            const err = authenticationError();
            expect(err.statusCode).toBe(401);
            expect(err.code).toBe(ErrorCode.AUTHENTICATION_ERROR);
            expect(err.message).toBe('Authentication required');
        });

        it('should accept a custom message', () => {
            const err = authenticationError('Token expired');
            expect(err.message).toBe('Token expired');
        });
    });

    describe('authorizationError', () => {
        it('should create a 403 AUTHORIZATION_ERROR with default message', () => {
            const err = authorizationError();
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe(ErrorCode.AUTHORIZATION_ERROR);
            expect(err.message).toBe('Forbidden');
        });

        it('should accept a custom message', () => {
            const err = authorizationError('Admin only');
            expect(err.message).toBe('Admin only');
        });
    });

    describe('internalError', () => {
        it('should create a 500 INTERNAL_ERROR with isOperational = false', () => {
            const err = internalError();
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
            expect(err.isOperational).toBe(false);
            expect(err.message).toBe('Internal server error');
        });

        it('should accept custom message and details', () => {
            const err = internalError('db down', { host: 'db01' });
            expect(err.message).toBe('db down');
            expect(err.details).toEqual({ host: 'db01' });
        });
    });
});

/* ================================================================== */
/*  ErrorCode enum completeness                                        */
/* ================================================================== */
describe('ErrorCode enum', () => {
    it('should contain all expected error categories', () => {
        expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
        expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
        expect(ErrorCode.AUTHENTICATION_ERROR).toBe('AUTHENTICATION_ERROR');
        expect(ErrorCode.AUTHORIZATION_ERROR).toBe('AUTHORIZATION_ERROR');
        expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });
});
