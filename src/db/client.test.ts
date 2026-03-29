import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConnection } from './client.js';

describe('getConnection', () => {
  const orig = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (orig !== undefined) process.env.DATABASE_URL = orig;
  });

  it('throws when DATABASE_URL is not set', () => {
    expect(() => getConnection()).toThrow('DATABASE_URL is required');
  });

  it('throws when DATABASE_URL is empty string', () => {
    process.env.DATABASE_URL = '';
    expect(() => getConnection()).toThrow('DATABASE_URL is required');
  });
});
