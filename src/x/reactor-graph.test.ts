import { describe, it, expect } from 'vitest';
import { buildReactorGraph, type ReactorInput } from './reactor-graph';
import { formatCompactCurrency } from '@/lib/format-currency';

const NULL_INPUT: ReactorInput = { ops: null, gate: null, recovered: null, fee: null };
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
  recovered: { zar: 1200000 },
  fee: { zar: 300000 },
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
  it('net = recovered − fee, and fee sub is % of collected', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const net = g.nodes.find(n => n.id === 'net');
    const fee = g.nodes.find(n => n.id === 'fee');
    expect(net?.value).toBe(formatCompactCurrency(900000, 'ZAR'));
    expect(fee?.sub).toBe('25% of collected');
  });
  it('fee null → net and fee render em-dash even when recovered is real', () => {
    const g = buildReactorGraph({ ...FULL_INPUT, fee: null }, 'ZAR', 'all');
    expect(g.nodes.find(n => n.id === 'net')?.value).toBe('—');
    expect(g.nodes.find(n => n.id === 'fee')?.value).toBe('—');
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
});
