import { describe, it, expect } from 'vitest';
import { buildReactorGraph, type ReactorInput } from './reactor-graph';
import { formatCompactCurrency } from '@/lib/format-currency';

const NULL_INPUT: ReactorInput = { ops: null, gate: null, recovered: null, fee: null, sourceCount: null };
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
  fee: { zar: 300000 },
  sourceCount: 3,
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
  it('net = recovered − fee; fee carries its own scope, never a cross-scope %', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const net = g.nodes.find(n => n.id === 'net');
    const fee = g.nodes.find(n => n.id === 'fee');
    expect(net?.value).toBe(formatCompactCurrency(900000, 'ZAR'));
    expect(fee?.sub).toBe('platform fee · all-time');
  });
  it('fee null → net and fee render em-dash even when recovered is real', () => {
    const g = buildReactorGraph({ ...FULL_INPUT, fee: null }, 'ZAR', 'all');
    expect(g.nodes.find(n => n.id === 'net')?.value).toBe('—');
    expect(g.nodes.find(n => n.id === 'fee')?.value).toBe('—');
  });
  it('leak→recovered bridge is dashed: this leak is not that recovery', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const bridge = g.edges.find(e => e.from === 'leak' && e.to === 'recovered');
    expect(bridge?.dashed).toBe(true);
  });
});

describe('seal gating', () => {
  it('only booked fields are sealed; computed and estimated never are', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    for (const id of ['recovered', 'fee', 'gate', 'review', 'reversed']) {
      expect(g.nodes.find(n => n.id === id)?.sealed, id).toBe(true);
    }
    expect(g.nodes.find(n => n.id === 'net')?.sealed).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'leak')?.sealed).toBeFalsy();
    expect(g.nodes.find(n => n.id === 'stage-procure')?.sealed).toBeFalsy();
  });
  it('every money node carries a provenance sentence', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    for (const id of ['leak', 'recovered', 'net', 'fee', 'gate']) {
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

describe('focus + persona lens', () => {
  it('decisions focus dims stages, keeps gate undimmed', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'decisions');
    expect(g.nodes.find(n => n.id === 'stage-procure')?.dim).toBe(true);
    expect(g.nodes.find(n => n.id === 'gate')?.dim).toBeFalsy();
  });
  it('ledger focus keeps recovered/net/fee undimmed', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'ledger');
    expect(g.nodes.find(n => n.id === 'net')?.dim).toBeFalsy();
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
