/**
 * formatCurrency (assessment-engine) — report money formatting.
 *
 * ZAR is the base. USD/EUR divide by the ZAR-per-unit exchange rate then
 * round. Unknown currencies fall back to ZAR with the raw (unconverted)
 * amount. Grouping is Intl en-ZA (non-breaking-space separators), so we
 * assert on the prefix and the digit payload rather than the exact string.
 */
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../assessment-engine';

/** strip everything but digits so the grouping separator can't make the test flaky */
const digits = (s: string): string => s.replace(/\D/g, '');

describe('formatCurrency', () => {
  it('ZAR: prefixes R and rounds, no conversion', () => {
    const out = formatCurrency(1_000_000, 'ZAR', 18);
    expect(out.startsWith('R ')).toBe(true);
    expect(digits(out)).toBe('1000000'); // exchangeRate ignored for ZAR
  });

  it('ZAR rounds to whole rand', () => {
    expect(digits(formatCurrency(1234.6, 'ZAR', 1))).toBe('1235');
    expect(digits(formatCurrency(1234.4, 'ZAR', 1))).toBe('1234');
  });

  it('USD: divides by rate, prefixes $, rounds', () => {
    const out = formatCurrency(1_000_000, 'USD', 18);
    expect(out.startsWith('$ ')).toBe(true);
    expect(digits(out)).toBe(String(Math.round(1_000_000 / 18))); // 55556
  });

  it('EUR: divides by rate, prefixes €', () => {
    const out = formatCurrency(1_000_000, 'EUR', 20);
    expect(out.startsWith('€ ')).toBe(true);
    expect(digits(out)).toBe('50000');
  });

  it('unknown currency falls back to ZAR with unconverted amount', () => {
    const out = formatCurrency(1_000_000, 'GBP', 18);
    expect(out.startsWith('R ')).toBe(true);
    expect(digits(out)).toBe('1000000'); // NOT divided by rate
  });
});
