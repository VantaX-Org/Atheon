import { describe, it, expect } from 'vitest';
import { confidenceGauge, immediateVsOngoing, sourceVsTarget } from '../finding-charts';

describe('finding-charts', () => {
  it('confidenceGauge: low/gate-failed confidence flagged indicative', () => {
    const svg = confidenceGauge(0.4, false);
    expect(svg).toContain('<svg');
    expect(svg.toLowerCase()).toContain('indicative');
  });

  it('confidenceGauge: high confidence not indicative', () => {
    const svg = confidenceGauge(0.95, true);
    expect(svg.toLowerCase()).not.toContain('indicative');
    expect(svg).toContain('95%');
  });

  it('immediateVsOngoing annualises ongoing (x12)', () => {
    const svg = immediateVsOngoing(1000, 500);
    expect(svg).toContain('<svg');
    expect(svg).toContain('6');
  });

  it('sourceVsTarget returns empty string when no samples', () => {
    expect(sourceVsTarget([])).toBe('');
  });

  it('sourceVsTarget caps samples and notes the remainder', () => {
    const samples = Array.from({ length: 9 }, (_, i) => ({ ref: `R${i}`, source_value: 100, target_value: 90, difference: 10 }));
    const svg = sourceVsTarget(samples, 5);
    expect(svg).toContain('<svg');
    expect(svg).toContain('4 more');
  });
});
