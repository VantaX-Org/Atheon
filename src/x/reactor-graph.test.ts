import { describe, it, expect } from 'vitest';
import { buildReactorGraph, type ReactorInput } from './reactor-graph';

const NULL_INPUT: ReactorInput = { world: null, health: null, connections: null, ops: null, gate: null, recovered: null };
const FULL_INPUT: ReactorInput = {
  world: { headwinds: 2, tailwinds: 3, regulatoryDeadlines: 1, signalCount: 9 },
  health: { score: 71, benchmark: 68 },
  connections: { total: 3, broken: 0 },
  ops: { categories: [{ key: 'procurement', label: 'Procurement', count: 12, valueZar: 4200000 }], totalZar: 4200000, totalCount: 12 },
  gate: { pendingCount: 4, pendingZar: 800000, reviewCount: 2, reviewZar: 100000, reversedCount: 1, reversedZar: 50000 },
  recovered: { zar: 1200000 },
};

describe('honesty law', () => {
  it('null input → em-dash values, zero particles everywhere', () => {
    const g = buildReactorGraph(NULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.every(n => n.value === '—')).toBe(true);
    expect(g.edges.every(e => e.particles === 0)).toBe(true);
  });
  it('never renders a literal 0 for a null field', () => {
    const g = buildReactorGraph(NULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.some(n => /(^|\s)R?0(\s|$)/.test(n.value))).toBe(false);
  });
  it('full input animates non-zero segments, gate edge pools', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const gateEdge = g.edges.find(e => e.to === 'gate');
    expect(gateEdge?.pool).toBe(true);
    expect(gateEdge!.particles).toBeGreaterThan(0);
  });
  it('no fee/ROI node in the reactor (commercial layer is Ledger-only)', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.find(n => /fee|roi/i.test(n.kicker))).toBeUndefined();
  });
});

describe('focus', () => {
  it('decisions focus dims world nodes, keeps gate undimmed', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'decisions');
    expect(g.nodes.find(n => n.id === 'tailwinds')?.dim).toBe(true);
    expect(g.nodes.find(n => n.id === 'gate')?.dim).toBeFalsy();
  });
});
