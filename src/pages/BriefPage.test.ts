import { describe, it, expect } from 'vitest';
import { amountFrom, freshnessLine } from './BriefPage';

describe('amountFrom — never invents money', () => {
  it('finds the first finite amount by key priority', () => {
    expect(amountFrom({ amount: 1200 })).toBe(1200);
    expect(amountFrom({ value: 50, amountZar: 99 })).toBe(99); // amountZar wins by order
    expect(amountFrom({ exposure: 4182309 })).toBe(4182309);
  });
  it('returns null rather than fabricating when no numeric field is present', () => {
    expect(amountFrom({})).toBeNull();
    expect(amountFrom({ note: 'see cluster' })).toBeNull();
    expect(amountFrom({ amount: 'lots' })).toBeNull();
    expect(amountFrom({ amount: NaN })).toBeNull();
    expect(amountFrom({ amount: Infinity })).toBeNull();
  });
});

describe('freshnessLine — honest degradation', () => {
  it('never claims fresh when it cannot confirm', () => {
    expect(freshnessLine(null)).toMatch(/unavailable/i);
    expect(freshnessLine({ globalStatus: 'unknown', oldestAgeMinutes: null, sections: [], checkedAt: '' })).toMatch(/could not be confirmed/i);
  });
  it('reports staleness with an age when it has one', () => {
    expect(freshnessLine({ globalStatus: 'stale', oldestAgeMinutes: 180, sections: [], checkedAt: '' })).toMatch(/3h/);
    expect(freshnessLine({ globalStatus: 'stale', oldestAgeMinutes: null, sections: [], checkedAt: '' })).toMatch(/stale/i);
  });
  it('confirms fresh only on a fresh global status', () => {
    expect(freshnessLine({ globalStatus: 'fresh', oldestAgeMinutes: 2, sections: [], checkedAt: '' })).toMatch(/fresh/i);
  });
});
