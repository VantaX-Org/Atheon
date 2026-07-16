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
  ops: {
    categories: Array<{ key: string; label: string; count: number; valueZar: number; unpriced?: number; topType?: string }>;
    totalZar: number; totalCount: number;
    estimated?: boolean; // raw-findings fallback — impacts are estimates, some unpriced
    unpricedCount?: number;
  } | null;
  gate: { pendingCount: number; pendingZar: number; reviewCount: number; reviewZar: number; reversedCount: number; reversedZar: number } | null;
  recovered: { zar: number; mult: number | null } | null;
  fee: { zar: number } | null;
  sourceCount: number | null; // live/connected ERP source systems
}

// Dominant finding_type → human leak descriptor (matches the artifact's stage
// sub-labels). Plural form; live-demo stage counts are all >1.
const TYPE_LABEL: Record<string, string> = {
  discrepancy: 'discrepancies', exception: 'exceptions',
  data_quality: 'data-quality flags', process_delay: 'process delays', risk: 'risks',
};

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

// C-suite lanes: each label names the band below its line. Internal/external
// is carried per-node by tags (the rows mix scopes, so bands can't claim it).
export const REACTOR_LANES = [
  { y: 0.015, label: 'Value chain — inside your business' },
  { y: 0.3, label: 'Recovery flow — across the boundary' },
  { y: 0.71, label: 'Decision queue — waiting on a signature' },
];

export function buildReactorGraph(
  input: ReactorInput,
  currency: string,
  focus: ReactorFocus,
  opsFirst: string[] = [],
  canApprove = false,
): { nodes: RiverNode[]; edges: RiverEdge[] } {
  const { ops, gate, recovered, fee } = input;
  const money = (v: number | null) => formatCompactCurrency(v, currency);
  const net = recovered && fee ? recovered.zar - fee.zar : null;

  // Sum each category into its value-chain stage. topType = leak descriptor of
  // the heaviest contributing category (only present on the raw-findings path).
  const known = new Set(STAGES.flatMap((s) => s.cats));
  const stageSum = (cats: string[], fold: boolean) => {
    if (!ops) return null;
    const mine = ops.categories.filter((c) => cats.includes(c.key) || (fold && !known.has(c.key)));
    const lead = [...mine].sort((a, b) => b.count - a.count)[0];
    return {
      valueZar: mine.reduce((s, c) => s + c.valueZar, 0),
      count: mine.reduce((s, c) => s + c.count, 0),
      unpriced: mine.reduce((s, c) => s + (c.unpriced ?? 0), 0),
      topType: lead?.topType,
    };
  };
  const stages = STAGES.map((s, i) => ({
    ...s,
    x: 0.07 + i * (0.84 / (STAGES.length - 1)),
    sum: stageSum(s.cats, s.id === 'stage-operate'),
  }));

  // Recovery is all-time; a leak is this assessment. We never divide one by the
  // other (that "% of detected" was a cross-scope lie). Instead every node
  // carries its own scope, and the ROI multiple is reported as the API's
  // number, not a formula we invented for it.
  const recSub = recovered
    ? (recovered.mult != null && recovered.mult > 0 ? `${Math.round(recovered.mult)}× ROI (reported) · all-time` : 'all-time')
    : undefined;
  const est = ops?.estimated;
  const stageSub = (sum: { count: number; unpriced: number; topType?: string } | null) => {
    if (!sum) return undefined;
    if (sum.count === 0) return 'no leakage found';
    const kind = `${sum.count} ${sum.topType ? (TYPE_LABEL[sum.topType] ?? 'findings') : 'findings'}`;
    return sum.unpriced > 0 ? `${kind} · ${sum.unpriced} unpriced` : kind;
  };
  // Drawer provenance sentences — booked API fields may carry the chain seal;
  // assessment estimates and client-computed figures say what they are.
  const PROV_FINDING = est
    ? 'Estimated from assessment findings — not yet recovered, not a ledger row. Unpriced findings are excluded from the figure.'
    : 'Priced from the assessment findings summary — an estimate until recovered and booked.';
  const PROV_BOOKED = 'Read live from a booked API field — never estimated, never invented. A dash means the source has not reported.';

  const leakSub = ops
    ? `${ops.totalCount} findings · this assessment${(ops.unpricedCount ?? 0) > 0 ? ` · ${ops.unpricedCount} unpriced` : ''}`
    : undefined;

  const nodes: RiverNode[] = [
    ...stages.map((s): RiverNode => ({
      id: s.id, x: s.x, y: 0.09, kicker: s.label,
      value: s.sum ? (s.sum.count > 0 && s.sum.valueZar === 0 && s.sum.unpriced > 0 ? '—' : money(s.sum.valueZar)) : '—',
      sub: stageSub(s.sum),
      cls: s.sum ? (s.sum.count > 0 ? 'stage leaky' : 'stage clean') : 'stage',
      anchor: 'leaks', prov: PROV_FINDING,
    })),
    { id: 'leak', x: 0.13, y: 0.52, kicker: est ? 'Estimated leakage' : 'Leakage detected', value: money(ops?.totalZar ?? null), tag: 'Internal', sub: leakSub, anchor: 'leaks', prov: PROV_FINDING },
    { id: 'recovered', x: 0.52, y: 0.50, kicker: 'Recovered', value: money(recovered?.zar ?? null), tone: recovered ? 'gold' : 'none', tag: 'External', sub: recSub, anchor: 'ledger', sealed: true, prov: PROV_BOOKED },
    { id: 'net', x: 0.88, y: 0.40, kicker: 'Net to you', value: money(net), tone: net != null ? 'gold' : 'none', tag: 'Internal', sub: net != null ? 'after the Atheon fee · computed' : undefined, anchor: 'ledger', prov: 'Computed on this screen as recovered minus the Atheon fee — both operands are booked fields, the subtraction is not itself a ledger row.' },
    { id: 'fee', x: 0.88, y: 0.60, kicker: 'Atheon fee', value: money(fee?.zar ?? null), tag: 'External', sub: fee ? 'platform fee · all-time' : undefined, anchor: 'ledger', sealed: true, prov: PROV_BOOKED },
    { id: 'gate', x: 0.54, y: 0.80, kicker: 'Awaiting signature', value: money(gate?.pendingZar ?? null), tag: canApprove ? 'Your call' : 'Internal', sub: gate ? `${gate.pendingCount} decision${gate.pendingCount === 1 ? '' : 's'} open · now` : undefined, anchor: 'decisions', sealed: true, prov: PROV_BOOKED },
    { id: 'review', x: 0.88, y: 0.84, kicker: 'In review', value: money(gate?.reviewZar ?? null), tag: 'Internal', sub: gate ? `${gate.reviewCount} previewed, not dispatched` : undefined, anchor: 'decisions', sealed: true, prov: PROV_BOOKED },
    { id: 'reversed', x: 0.30, y: 0.88, kicker: 'Rejected or failed', value: money(gate?.reversedZar ?? null), tone: gate && gate.reversedZar > 0 ? 'bad' : 'none', tag: 'Mixed', sub: gate ? `${gate.reversedCount} rejected (yours) or failed · all-time` : undefined, anchor: 'decisions', sealed: true, prov: PROV_BOOKED },
  ];

  // Per-zone width normalization: a global max let the all-time recovered figure
  // (100× a stage) floor every stage edge to a hairline AND implied a false
  // money-conservation across scopes. Each zone is normalized to its own max,
  // widths via sqrt so small flows stay visible, and the leak→recovered bridge
  // is a thin dashed connector — it connects scopes, it doesn't claim the
  // leak "became" the all-time recovery.
  const stageMax = Math.max(1, ...stages.map((s) => s.sum?.valueZar ?? 0));
  const queueMax = Math.max(1, gate?.pendingZar ?? 0, gate?.reviewZar ?? 0, gate?.reversedZar ?? 0);
  const resultsMax = Math.max(1, recovered?.zar ?? 0, net ?? 0, fee?.zar ?? 0);

  const edge = (from: string, to: string, v: number | null, colorVar: string, zoneMax: number, pool?: boolean): RiverEdge => {
    const norm = v == null ? null : Math.sqrt(Math.min(1, v / zoneMax));
    const amt = norm == null ? 0.14 : Math.max(0.16, Math.min(1, 0.16 + norm * 0.84));
    const particles = v == null || v === 0 ? 0 : Math.max(2, Math.min(9, Math.round(amt * 9)));
    return { from, to, amt, colorVar, particles, pool, dashed: v == null || undefined };
  };

  const edges: RiverEdge[] = [
    // thin grey process chain along the value chain
    ...stages.slice(1).map((s, i): RiverEdge => ({
      from: stages[i].id, to: s.id, amt: 0.18, colorVar: '--f-revw', particles: ops ? 2 : 0,
    })),
    // each leaking stage feeds the hub
    ...stages.filter((s) => (s.sum?.valueZar ?? 0) > 0).map((s) => edge(s.id, 'leak', s.sum!.valueZar, '--f-leak', stageMax)),
    // bridge between scopes: thin dashed connector — this assessment's leak did
    // NOT become the all-time recovery, so the pipe never claims a flow
    { from: 'leak', to: 'recovered', amt: 0.2, colorVar: '--f-rec', particles: recovered && recovered.zar > 0 ? 2 : 0, dashed: true },
    edge('recovered', 'net', net, '--f-rec', resultsMax),
    edge('recovered', 'fee', fee?.zar ?? null, '--f-fee', resultsMax),
    edge('leak', 'gate', gate?.pendingZar ?? null, '--f-gate', queueMax, true),
    edge('leak', 'review', gate?.reviewZar ?? null, '--f-revw', queueMax),
    edge('leak', 'reversed', gate?.reversedZar ?? null, '--f-rev', queueMax),
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
