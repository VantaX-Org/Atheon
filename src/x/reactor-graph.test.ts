import { describe, it, expect } from 'vitest';
import { buildReactorGraph, type ReactorInput } from './reactor-graph';

const NULL_INPUT: ReactorInput = { ops: null, gate: null, recovered: null, sourceCount: null, macro: null, health: null, pulse: null };
const FULL_INPUT: ReactorInput = {
  ops: {
    categories: [
      { key: 'procurement', label: 'Procurement', count: 12, valueZar: 4200000 },
      { key: 'finance', label: 'Finance', count: 6, valueZar: 1000000 },
      { key: 'compliance', label: 'Compliance', count: 0, valueZar: 0 },
    ],
    totalZar: 5200000, totalCount: 18,
  },
  gate: { pendingCount: 4, pendingZar: 800000, reviewCount: 2, reviewZar: 100000, reversedCount: 1, reversedZar: 50000 },
  recovered: { zar: 1200000, mult: 4 },
  sourceCount: 3,
  macro: { count: 2, signals: [{ id: 'sig-1', title: 'ZAR swings past R19', source: 'Reuters', sentiment: 'negative', relevance: 0.9 }] },
  health: {
    overall: 73,
    dims: {
      financial: { score: 69, trend: 'declining', delta: -21 },
      operational: { score: 94, trend: 'improving', delta: 4 },
      supply_chain: { score: 58, trend: 'declining', delta: -4.8 },
    },
  },
  pulse: { healthDelta: 1, redMetricCount: 9, anomalyCount: 10, activeRiskCount: 15 },
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
  it('null-fed money edges are dashed (motion-free honesty channel)', () => {
    const g = buildReactorGraph(NULL_INPUT, 'ZAR', 'all');
    // the stage-to-stage grey thread is process shape, not money — exempt
    const moneyEdges = g.edges.filter(e => !(e.from.startsWith('stage-') && e.to.startsWith('stage-')));
    expect(moneyEdges.length).toBeGreaterThan(0);
    expect(moneyEdges.every(e => e.dashed)).toBe(true);
  });
  it('full input animates non-zero segments, gate edge pools', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const gateEdge = g.edges.find(e => e.to === 'gate');
    expect(gateEdge?.pool).toBe(true);
    expect(gateEdge!.particles).toBeGreaterThan(0);
  });
  it('recovered is the gold terminal, scoped all-time with the reported ROI', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const rec = g.nodes.find(n => n.id === 'recovered');
    expect(rec?.tone).toBe('gold');
    expect(rec?.sub).toBe('4× ROI (reported) · all-time');
  });
  it('gate→recovered bridge is dashed: pending-now is not recovered-yet', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const bridge = g.edges.find(e => e.from === 'gate' && e.to === 'recovered');
    expect(bridge?.dashed).toBe(true);
  });
  it('no vendor plumbing: net and fee nodes do not exist', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.some(n => n.id === 'net' || n.id === 'fee')).toBe(false);
  });
  it('macro edge is dashed context, never a money flow', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const m = g.edges.find(e => e.from === 'macro');
    expect(m?.dashed).toBe(true);
  });
});

describe('seal gating', () => {
  it('only booked fields are sealed; computed and estimated never are', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    for (const id of ['recovered', 'gate', 'review', 'reversed']) {
      expect(g.nodes.find(n => n.id === id)?.sealed, id).toBe(true);
    }
    expect(g.nodes.find(n => n.id === 'leak')?.sealed).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'macro')?.sealed).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'stage-procure')?.sealed).toBeFalsy();
  });
  it('every money node carries a provenance sentence', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    for (const id of ['leak', 'recovered', 'gate', 'macro']) {
      expect(g.nodes.find(n => n.id === id)?.prov, id).toBeTruthy();
    }
  });
});

describe('estimated fallback', () => {
  const EST_INPUT: ReactorInput = {
    ...FULL_INPUT,
    ops: {
      categories: [
        { key: 'finance', label: 'Finance', count: 3, valueZar: 500000, unpriced: 1 },
        { key: 'compliance', label: 'Compliance', count: 2, valueZar: 0, unpriced: 2 },
      ],
      totalZar: 500000, totalCount: 5, estimated: true, unpricedCount: 3,
    },
  };
  it('estimated ops retitle the hub and surface unpriced counts', () => {
    const g = buildReactorGraph(EST_INPUT, 'ZAR', 'all');
    const leak = g.nodes.find(n => n.id === 'leak');
    expect(leak?.kicker).toBe('Estimated leakage');
    expect(leak?.sub).toContain('3 unpriced');
  });
  it('an all-unpriced stage shows an em-dash, never R 0', () => {
    const g = buildReactorGraph(EST_INPUT, 'ZAR', 'all');
    const tax = g.nodes.find(n => n.id === 'stage-tax'); // compliance folds here
    expect(tax?.value).toBe('—');
    expect(tax?.sub).toContain('2 unpriced');
  });
});

describe('value-chain stages', () => {
  it('categories fold into their stage; clean stages marked clean', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const procure = g.nodes.find(n => n.id === 'stage-procure');
    const tax = g.nodes.find(n => n.id === 'stage-tax');
    expect(procure?.sub).toBe('12 findings');
    expect(procure?.cls).toBe('stage leaky');
    expect(tax?.cls).toBe('stage clean');
  });
  it('only leaking stages feed the hub', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    expect(g.edges.some(e => e.from === 'stage-procure' && e.to === 'leak')).toBe(true);
    expect(g.edges.some(e => e.from === 'stage-tax' && e.to === 'leak')).toBe(false);
  });
});

describe('stage health trend', () => {
  it('stages read their trend from the mapped health dimension', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const pay = g.nodes.find(n => n.id === 'stage-pay'); // finance → financial
    expect(pay?.trend).toEqual({ dir: 'down', score: 69, delta: -21 });
    const receive = g.nodes.find(n => n.id === 'stage-receive'); // supply_chain
    expect(receive?.trend?.dir).toBe('down');
    const operate = g.nodes.find(n => n.id === 'stage-operate'); // operational
    expect(operate?.trend).toEqual({ dir: 'up', score: 94, delta: 4 });
  });
  it('a silent dimension leaves the stage without a trend chip', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.find(n => n.id === 'stage-sell')?.trend).toBeUndefined(); // revenue dim absent
  });
  it('null health → no trend anywhere, never a fabricated flat', () => {
    const g = buildReactorGraph(NULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.every(n => n.trend === undefined)).toBe(true);
  });
  it('macro head carries no trend — it is not a health-scored stage', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.find(n => n.id === 'macro')?.trend).toBeUndefined();
  });
});

describe('focus + persona lens', () => {
  it('decisions focus dims stages, keeps gate undimmed', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'decisions');
    expect(g.nodes.find(n => n.id === 'stage-procure')?.dim).toBe(true);
    expect(g.nodes.find(n => n.id === 'gate')?.dim).toBeFalsy();
  });
  it('ledger focus keeps recovered undimmed, dims the queue', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'ledger');
    expect(g.nodes.find(n => n.id === 'recovered')?.dim).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'gate')?.dim).toBe(true);
  });
  it('opsFirst greys stages outside the persona remit on the full view', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'brief', ['procurement', 'supply_chain']);
    expect(g.nodes.find(n => n.id === 'stage-procure')?.dim).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'stage-pay')?.dim).toBe(true);
  });
  it('gate tag reflects approval rights', () => {
    expect(buildReactorGraph(FULL_INPUT, 'ZAR', 'all', [], true).nodes.find(n => n.id === 'gate')?.tag).toBe('Your call');
    expect(buildReactorGraph(FULL_INPUT, 'ZAR', 'all', [], false).nodes.find(n => n.id === 'gate')?.tag).toBe('Internal');
  });
});
