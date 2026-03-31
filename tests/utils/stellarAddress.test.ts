import { describe, it, expect } from 'vitest';
import { isValidStellarAddress } from '../../src/utils/stellarAddress.js';

const VALID = 'G' + 'A'.repeat(55);

describe('isValidStellarAddress', () => {
  it('returns true for a valid Stellar address', () => {
    expect(isValidStellarAddress(VALID)).toBe(true);
  });

  it('returns true for an address using digits 2 through 7', () => {
    expect(isValidStellarAddress('G' + '2'.repeat(55))).toBe(true);
    expect(isValidStellarAddress('G' + '7'.repeat(55))).toBe(true);
  });

  it('returns false for an address that is too short', () => {
    expect(isValidStellarAddress('GABCDEF')).toBe(false);
  });

  it('returns false for an address that is too long', () => {
    expect(isValidStellarAddress('G' + 'A'.repeat(56))).toBe(false);
  });

  it('returns false for an address that does not start with G', () => {
    expect(isValidStellarAddress('A' + 'A'.repeat(55))).toBe(false);
  });

  it('returns false for an address containing digit 0', () => {
    expect(isValidStellarAddress('G' + '0'.repeat(55))).toBe(false);
  });

  it('returns false for an address containing digit 1', () => {
    expect(isValidStellarAddress('G' + '1'.repeat(55))).toBe(false);
  });

  it('returns false for an address containing digit 8', () => {
    expect(isValidStellarAddress('G' + '8'.repeat(55))).toBe(false);
  });

  it('returns false for an address containing lowercase letters', () => {
    expect(isValidStellarAddress('G' + 'a'.repeat(55))).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });
});
