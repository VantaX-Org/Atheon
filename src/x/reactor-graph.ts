// Builds the reactor river: the value chain across the top (stages leak into
// the hub), then the recovery machine — recovered splits into net-to-you and
// the Atheon fee, with the gate / review / reversed pools beneath. Geometry
// lifted from the "Atheon — Recovery Console" artifact BRIEF flow.
// Honesty law: a null section renders em-dash nodes and static (0-particle)
// edges — never a fabricated zero. Net is only computed when both recovered
// and fee are real.

import { formatCompactCurrency } from '@/lib/format-currency';
import type { RiverEdge, RiverNode } from './river';

export type SectionKey = 'brief' | 'decisions' | 'ledger' | 'catalysts';
export type ReactorFocus = SectionKey | 'all';

export interface ReactorInput {
  ops: { categories: Array<{ key: string; label: string; count: number; valueZar: number }>; totalZar: number; totalCount: number } | null;
  gate: { pendingCount: number; pendingZar: number; reviewCount: number; reviewZar: number; reversedCount: number; reversedZar: number } | null;
  recovered: { zar: number } | null;
  fee: { zar: number } | null;
}

// Fixed value-chain order; API categories fold into their stage. Unknown
// category keys land in "Operate & deliver" so nothing is silently dropped.
export const STAGES: Array<{ id: string; label: string; cats: string[] }> = [
  { id: 'stage-procure', label: 'Procure & contract', cats: ['procurement'] },
  { id: 'stage-receive', label: 'Receive & store', cats: ['supply_chain'] },
  { id: 'stage-operate', label: 'Operate & deliver', cats: ['service_delivery', 'workforce', 'cross_cutting'] },
  { id: 'stage-sell', label: 'Sell & invoice', cats: ['sales'] },
  { id: 'stage-pay', label: 'Pay & account', cats: ['finance'] },
  { id: 'stage-tax', label: 'Tax & filings', cats: ['compliance'] },
];

const DIM: Record<ReactorFocus, (id: string) => boolean> = {
  all: () => false,
  brief: () => false,
  decisions: (id) => id.startsWith('stage-') || id === 'leak' || ['recovered', 'net', 'fee'].includes(id),
  ledger: (id) => id.startsWith('stage-') || ['gate', 'review', 'reversed'].includes(id),
  catalysts: (id) => ['net', 'fee', 'review', 'reversed'].includes(id),
};

export function buildReactorGraph(
  input: ReactorInput,
  currency: string,
  focus: ReactorFocus,
  opsFirst: string[] = [],
): { nodes: RiverNode[]; edges: RiverEdge[] } {
  const { ops, gate, recovered, fee } = input;
  const money = (v: number | null) => formatCompactCurrency(v, currency);
  const net = recovered && fee ? recovered.zar - fee.zar : null;
  const pct = (part: number | null, whole: number | null) =>
    part != null && whole != null && whole > 0 ? `${Math.round((part / whole) * 100)}%` : null;

  // Sum each category into its value-chain stage.
  const known = new Set(STAGES.flatMap((s) => s.cats));
  const stageSum = (cats: string[], fold: boolean) => {
    if (!ops) return null;
    const mine = ops.categories.filter((c) => cats.includes(c.key) || (fold && !known.has(c.key)));
    return { valueZar: mine.reduce((s, c) => s + c.valueZar, 0), count: mine.reduce((s, c) => s + c.count, 0) };
  };
  const stages = STAGES.map((s, i) => ({
    ...s,
    x: 0.07 + i * (0.84 / (STAGES.length - 1)),
    sum: stageSum(s.cats, s.id === 'stage-operate'),
  }));

  const recPct = pct(recovered?.zar ?? null, ops?.totalZar ?? null);
  const feePct = pct(fee?.zar ?? null, recovered?.zar ?? null);

  const nodes: RiverNode[] = [
    ...stages.map((s): RiverNode => ({
      id: s.id, x: s.x, y: 0.09, kicker: s.label,
      value: s.sum ? money(s.sum.valueZar) : '—',
      sub: s.sum ? (s.sum.count > 0 ? `${s.sum.count} findings` : 'clean') : undefined,
      cls: s.sum ? (s.sum.count > 0 ? 'stage leaky' : 'stage clean') : 'stage',
      anchor: 'leaks',
    })),
    { id: 'leak', x: 0.13, y: 0.52, kicker: 'Leakage detected', value: money(ops?.totalZar ?? null), sub: ops ? `${ops.totalCount} findings` : undefined, anchor: 'leaks' },
    { id: 'recovered', x: 0.52, y: 0.50, kicker: 'Recovered', value: money(recovered?.zar ?? null), tone: recovered ? 'gold' : 'none', sub: recPct ? `${recPct} of detected` : undefined, anchor: 'ledger' },
    { id: 'net', x: 0.88, y: 0.40, kicker: 'Net to you', value: money(net), tone: net != null ? 'gold' : 'none', sub: net != null ? 'after the Atheon fee' : undefined, anchor: 'ledger' },
    { id: 'fee', x: 0.88, y: 0.60, kicker: 'Atheon fee', value: money(fee?.zar ?? null), sub: feePct ? `${feePct} of collected` : undefined, anchor: 'ledger' },
    { id: 'gate', x: 0.54, y: 0.80, kicker: 'Awaiting signature', value: money(gate?.pendingZar ?? null), sub: gate ? `${gate.pendingCount} decisions` : undefined, anchor: 'decisions' },
    { id: 'review', x: 0.88, y: 0.84, kicker: 'In review', value: money(gate?.reviewZar ?? null), sub: gate ? `${gate.reviewCount} actions` : undefined, anchor: 'decisions' },
    { id: 'reversed', x: 0.30, y: 0.88, kicker: 'Reversed', value: money(gate?.reversedZar ?? null), tone: gate && gate.reversedZar > 0 ? 'bad' : 'none', anchor: 'decisions' },
  ];

  const moneyVals = [ops?.totalZar, gate?.pendingZar, gate?.reviewZar, gate?.reversedZar, recovered?.zar, fee?.zar, net, ...stages.map((s) => s.sum?.valueZar)]
    .filter((v): v is number => v != null);
  const maxMoney = Math.max(1, ...moneyVals);

  const edge = (from: string, to: string, v: number | null, colorVar: string, pool?: boolean): RiverEdge => {
    const amt = v == null ? 0.12 : Math.max(0.12, Math.min(1, v / maxMoney));
    const particles = v == null || v === 0 ? 0 : Math.max(1, Math.min(4, Math.round(amt * 4)));
    return { from, to, amt, colorVar, particles, pool };
  };

  const edges: RiverEdge[] = [
    // thin grey process chain along the value chain
    ...stages.slice(1).map((s, i): RiverEdge => ({
      from: stages[i].id, to: s.id, amt: 0.18, colorVar: '--f-revw', particles: ops ? 2 : 0,
    })),
    // each leaking stage feeds the hub
    ...stages.filter((s) => (s.sum?.valueZar ?? 0) > 0).map((s) => edge(s.id, 'leak', s.sum!.valueZar, '--f-leak')),
    edge('leak', 'recovered', recovered?.zar ?? null, '--f-rec'),
    edge('recovered', 'net', net, '--f-rec'),
    edge('recovered', 'fee', fee?.zar ?? null, '--f-fee'),
    edge('leak', 'gate', gate?.pendingZar ?? null, '--f-gate', true),
    edge('leak', 'review', gate?.reviewZar ?? null, '--f-revw'),
    edge('leak', 'reversed', gate?.reversedZar ?? null, '--f-rev'),
  ];

  const dim = DIM[focus];
  // persona lens: on the full view, stages outside the persona's remit grey out
  const offBand = (id: string) => {
    if (!opsFirst.length || (focus !== 'brief' && focus !== 'all')) return false;
    const stage = STAGES.find((s) => s.id === id);
    return !!stage && !stage.cats.some((c) => opsFirst.includes(c));
  };
  nodes.forEach((n) => { if (dim(n.id) || offBand(n.id)) n.dim = true; });
  edges.forEach((e) => { if (dim(e.from) || dim(e.to)) e.dim = true; });

  return { nodes, edges };
}
