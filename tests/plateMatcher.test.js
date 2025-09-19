import { describe, it, expect } from 'vitest';
import {
  formatPlate,
  isLikelyPlate,
  normalizePlate,
  scorePlateConfidence,
  tryMatchPlate,
} from '../scripts/plateMatcher.js';

describe('normalizePlate', () => {
  it('removes non-alphanumeric characters and uppercases', () => {
    expect(normalizePlate(' ab-12 cde ')).toBe('AB12CDE');
  });
});

describe('formatPlate', () => {
  it('formats UK/EU style plates with a space', () => {
    expect(formatPlate('AB12CDE')).toBe('AB12 CDE');
  });

  it('keeps unexpected lengths intact', () => {
    expect(formatPlate('A1')).toBe('A1');
  });
});

describe('isLikelyPlate', () => {
  it('rejects values shorter than five characters', () => {
    expect(isLikelyPlate('A12')).toBe(false);
  });

  it('accepts modern UK plate patterns and rejects others', () => {
    expect(isLikelyPlate('AB12CDE')).toBe(true);
    expect(isLikelyPlate('1234ABC')).toBe(false);
  });
});

describe('scorePlateConfidence', () => {
  it('boosts confidence for plates that match known patterns', () => {
    expect(scorePlateConfidence('AB12CDE', 70)).toBe(85);
    expect(scorePlateConfidence('ZZZ1234', 40)).toBe(40);
  });

  it('never returns a value above 100 or below 0', () => {
    expect(scorePlateConfidence('AB12CDE', 500)).toBe(100);
    expect(scorePlateConfidence('??', -5)).toBe(0);
  });
});

describe('tryMatchPlate', () => {
  it('returns undefined when the input is not a likely plate', () => {
    expect(tryMatchPlate('nope', 10)).toBeUndefined();
    expect(tryMatchPlate(undefined, 10)).toBeUndefined();
  });

  it('returns metadata for plausible matches', () => {
    const result = tryMatchPlate('ab12 cde', 67);
    expect(result).toEqual({
      raw: 'ab12 cde',
      normalized: 'AB12CDE',
      formatted: 'AB12 CDE',
      isHighConfidence: true,
      baseConfidence: 67,
    });
  });
});
