import { describe, it, expect } from 'vitest';
import { signedMagnitude, byDimension, simulate, netOf } from '@/pages/OutlookPage';

const imp = (dimension: string, dir: 'positive' | 'negative' | 'neutral', mag: number) =>
  ({ dimension, impactDirection: dir, impactMagnitude: mag } as never);

describe('Outlook simulation math', () => {
  it('signs magnitude by direction, and treats non-finite as 0', () => {
    expect(signedMagnitude({ impactDirection: 'positive', impactMagnitude: 5 })).toBe(5);
    expect(signedMagnitude({ impactDirection: 'negative', impactMagnitude: 5 })).toBe(-5);
    expect(signedMagnitude({ impactDirection: 'neutral', impactMagnitude: 5 })).toBe(0);
    expect(signedMagnitude({ impactDirection: 'negative', impactMagnitude: NaN as number })).toBe(0);
  });

  it('aggregates per dimension and sorts by absolute net', () => {
    const dims = byDimension([imp('cash', 'negative', 8), imp('cash', 'positive', 2), imp('growth', 'positive', 3)]);
    expect(dims).toEqual([{ dimension: 'cash', net: -6 }, { dimension: 'growth', net: 3 }]);
  });

  it('scales only headwinds; tailwinds and net move honestly', () => {
    const dims = [{ dimension: 'cash', net: -6 }, { dimension: 'growth', net: 3 }];
    expect(netOf(dims)).toBe(-3);
    const sim = simulate(dims, 2);
    expect(sim).toEqual([{ dimension: 'cash', net: -12 }, { dimension: 'growth', net: 3 }]);
    expect(netOf(sim)).toBe(-9); // headwind doubled, tailwind untouched
  });

  it('intensity 1 is identity', () => {
    const dims = [{ dimension: 'cash', net: -6 }, { dimension: 'growth', net: 3 }];
    expect(simulate(dims, 1)).toEqual(dims);
  });
});
