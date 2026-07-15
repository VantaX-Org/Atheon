import { describe, it, expect } from 'vitest';
import { formatMoneyCompact, formatMoneyFull } from '@/lib/money';

// The one rule that must never break: a claim is never rounded UP (forensic F9).
describe('formatMoneyCompact', () => {
  it('truncates, never rounds a claim up', () => {
    expect(formatMoneyCompact(4_197_310, 'ZAR')).toBe('R4.19m'); // not R4.2m
    expect(formatMoneyCompact(4_200_000, 'ZAR')).toBe('R4.2m');
    expect(formatMoneyCompact(412_380, 'ZAR')).toBe('R412k');
    expect(formatMoneyCompact(1_243_900_000, 'ZAR')).toBe('R1.24bn');
  });
  it('shows full grouped below 100k (no precision lost)', () => {
    expect(formatMoneyCompact(38_214, 'ZAR')).toBe('R 38 214');
  });
  it('uses a true minus for negatives', () => {
    expect(formatMoneyCompact(-120_000, 'ZAR')).toBe('−R120k');
  });
  it('returns em-dash for null/NaN — never a zero claim', () => {
    expect(formatMoneyCompact(null, 'ZAR')).toBe('—');
    expect(formatMoneyCompact(undefined, 'ZAR')).toBe('—');
    expect(formatMoneyCompact(NaN, 'ZAR')).toBe('—');
  });
});

describe('formatMoneyFull', () => {
  it('groups to SA locale, truncated toward zero', () => {
    expect(formatMoneyFull(4_182_309, 'ZAR')).toBe('R 4 182 309');
    expect(formatMoneyFull(null, 'ZAR')).toBe('—');
  });
});
