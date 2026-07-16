import { describe, expect, it } from 'vitest';
import { catalystMiniRiver, consoleNavRiver, journeyRiver } from './flows';

describe('journeyRiver', () => {
  it('is labels-only — no node value parses as a number', () => {
    const g = journeyRiver();
    expect(g.nodes).toHaveLength(5);
    for (const n of g.nodes) expect(Number.isNaN(Number(n.value))).toBe(true);
  });
});

describe('consoleNavRiver', () => {
  it('maps groups to clickable nodes with real section counts', () => {
    const g = consoleNavRiver(
      [
        { key: 'platform', title: 'Platform', sections: 6 },
        { key: 'support', title: 'Support', sections: 4 },
      ],
      'support',
    );
    expect(g.nodes.map((n) => n.value)).toEqual(['6', '4']);
    expect(g.nodes[1].tone).toBe('gold');
    expect(g.edges).toHaveLength(1);
  });
});

describe('catalystMiniRiver', () => {
  it('null ledger → static thread, zero particles', () => {
    const g = catalystMiniRiver(null, 100);
    expect(g.edges.every((e) => e.particles === 0)).toBe(true);
    expect(g.edges.every((e) => e.amt <= 0.12)).toBe(true);
  });
  it('zero realized → no fake liveliness', () => {
    const g = catalystMiniRiver({ realized: 0, runs: 5 }, 100);
    expect(g.edges[0].particles).toBe(0);
    expect(g.edges[1].particles).toBe(1);
  });
  it('nodes are canvas-only (empty kicker skips tiles)', () => {
    const g = catalystMiniRiver({ realized: 50, runs: 3 }, 100);
    expect(g.nodes.every((n) => n.kicker === '')).toBe(true);
    expect(g.edges[0].particles).toBeGreaterThan(0);
  });
});
