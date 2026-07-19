// Builds the reactor river: the value chain across the top (stages leak into
// the hub), recovery landing at the gold terminal on the right, with the
// gate / review / reversed pools beneath. This is the org's own console —
// no vendor framing, no fee plumbing on screen.
// Honesty law: a null section renders em-dash nodes and static (0-particle)
// edges — never a fabricated zero.

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
  gate: {
    pendingCount: number; pendingZar: number; reviewCount: number; reviewZar: number; reversedCount: number; reversedZar: number;
    // receipt lines: the split behind the merged reversed figure, and the
    // actual decisions waiting at the gate (top slice, not the full queue)
    rejectedCount?: number; rejectedZar?: number; failedCount?: number; failedZar?: number;
    pending?: Array<{ label: string; type: string; valueZar: number }>;
  } | null;
  recovered: { zar: number; mult: number | null; bySource?: Array<{ label: string; zar: number; share: number; records: number }> } | null;
  sourceCount: number | null; // live/connected ERP source systems
  // External factors head node: live radar signals (macro, market, regulatory,
  // supplier pressure). Null when the radar has not reported — em-dash node.
  macro: {
    count: number;
    signals: Array<{ id: string; title: string; source: string | null; sentiment: string; relevance: number }>;
  } | null;
  // Live health dimensions (apex health engine). Null when the engine has not
  // reported — stages then carry no trend chip (absence, never a fabricated flat).
  health: {
    overall: number;
    dims: Record<string, { score: number; trend: string; delta: number | null }>;
  } | null;
  // Since-last-period pulse from the apex briefing — the hero delta strip.
  pulse: {
    healthDelta: number | null;
    redMetricCount: number | null;
    anomalyCount: number | null;
    activeRiskCount: number | null;
  } | null;
}

// Each category bucket reads its trend from the health dimension that actually
// measures it. Buckets without an honest dimension are simply absent.
export const BUCKET_DIM: Record<string, string> = {
  finance: 'financial', sales: 'revenue', supply_chain: 'supply_chain',
  compliance: 'compliance', procurement: 'operational',
  service_delivery: 'operational', workforce: 'operational', cross_cutting: 'operational',
};

// A role-specific value chain: same category buckets, re-cut and re-labelled
// for how that role runs the business (persona.ts defines the C-suite chains).
// Every chain must PARTITION the full bucket set so stages always sum to the
// leak hub — no category silently dropped, none counted twice.
export interface ChainStage {
  id: string;
  label: string;
  buckets: string[];
}

// GAP-1 fix: the assessment emits finding-TYPE keys (duplicate_payment,
// inventory_variance, …) alongside the canonical stage buckets. Each bucket
// expands to every key that folds into it, so stages price real findings
// instead of rendering em-dash while "Operate & deliver" swallows everything.
export const CAT_KEYS: Record<string, string[]> = {
  procurement: ['procurement', 'payment_terms', 'price_variance', 'supplier_risk'],
  supply_chain: ['supply_chain', 'inventory_variance', 'dead_stock'],
  service_delivery: ['service_delivery', 'process_issue'],
  workforce: ['workforce', 'payroll_anomaly'],
  cross_cutting: ['cross_cutting', 'data_issue'],
  sales: ['sales'],
  finance: ['finance', 'reconciliation', 'duplicate_payment'],
  compliance: ['compliance', 'fraud_risk', 'security_risk'],
};

// Dominant finding_type → human leak descriptor (matches the artifact's stage
// sub-labels). Plural form; live-demo stage counts are all >1.
const TYPE_LABEL: Record<string, string> = {
  discrepancy: 'discrepancies', exception: 'exceptions',
  data_quality: 'data-quality flags', process_delay: 'process delays', risk: 'risks',
};

// Canonical value-chain order (the whole-business lens: CEO, board, and any
// persona without a role chain). API categories fold into their stage via
// CAT_KEYS; unknown keys land in the cross_cutting stage so nothing drops.
export const STAGES: ChainStage[] = [
  { id: 'procure', label: 'Procure & contract', buckets: ['procurement'] },
  { id: 'receive', label: 'Receive & store', buckets: ['supply_chain'] },
  { id: 'operate', label: 'Operate & deliver', buckets: ['service_delivery', 'workforce', 'cross_cutting'] },
  { id: 'sell', label: 'Sell & invoice', buckets: ['sales'] },
  { id: 'pay', label: 'Pay & account', buckets: ['finance'] },
  { id: 'tax', label: 'Tax & filings', buckets: ['compliance'] },
];

const DIM: Record<ReactorFocus, (id: string) => boolean> = {
  all: () => false,
  brief: () => false,
  decisions: (id) => id.startsWith('stage-') || id === 'macro' || id === 'leak' || id === 'recovered',
  ledger: (id) => id.startsWith('stage-') || id === 'macro' || ['gate', 'review', 'reversed'].includes(id),
  catalysts: (id) => ['review', 'reversed'].includes(id),
};

// C-suite lanes: each label names the band below its line. Internal/external
// is carried per-node by tags (the rows mix scopes, so bands can't claim it).
export const REACTOR_LANES = [
  { y: 0.015, label: 'Value chain — inside your business' },
  { y: 0.34, label: 'Recovery flow — across the boundary' },
  { y: 0.71, label: 'Decision queue — waiting on a signature' },
];

export function buildReactorGraph(
  input: ReactorInput,
  currency: string,
  focus: ReactorFocus,
  opsFirst: string[] = [],
  canApprove = false,
  chain?: ChainStage[],
): { nodes: RiverNode[]; edges: RiverEdge[] } {
  const { ops, gate, recovered, macro, health } = input;
  const money = (v: number | null) => formatCompactCurrency(v, currency);

  const CHAIN = chain?.length ? chain : STAGES;
  const expand = (buckets: string[]) => buckets.flatMap((b) => CAT_KEYS[b] ?? [b]);

  // Sum each category into its value-chain stage. topType = leak descriptor of
  // the heaviest contributing category (only present on the raw-findings path).
  const known = new Set(Object.values(CAT_KEYS).flat());
  const stageSum = (keys: string[], fold: boolean) => {
    if (!ops) return null;
    const mine = ops.categories.filter((c) => keys.includes(c.key) || (fold && !known.has(c.key)));
    const lead = [...mine].sort((a, b) => b.count - a.count)[0];
    return {
      valueZar: mine.reduce((s, c) => s + c.valueZar, 0),
      count: mine.reduce((s, c) => s + c.count, 0),
      unpriced: mine.reduce((s, c) => s + (c.unpriced ?? 0), 0),
      topType: lead?.topType,
      cats: mine,
    };
  };
  // macro head node takes the leftmost slot; the chain spreads to its right
  const foldIdx = Math.max(0, CHAIN.findIndex((s) => s.buckets.includes('cross_cutting')));
  const stages = CHAIN.map((s, i) => ({
    ...s,
    id: `stage-${s.id}`,
    x: 0.21 + i * (0.72 / (CHAIN.length - 1)),
    sum: stageSum(expand(s.buckets), i === foldIdx),
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

  // Leak node drills into WHERE it leaks: each leaking stage, priced from the
  // same findings, heaviest first. From here the stage's own tile opens the
  // category breakdown, and "Open Leaks" reaches the finding-level list.
  const leakRows = stages
    .filter((s) => s.sum && s.sum.count > 0)
    .sort((a, b) => b.sum!.valueZar - a.sum!.valueZar)
    .map((s) => ({
      label: s.label,
      value: s.sum!.valueZar > 0 ? money(s.sum!.valueZar) : '—',
      sub: `${s.sum!.count} finding${s.sum!.count === 1 ? '' : 's'}`,
    }));

  // Drill-down payloads: what leaks inside a stage (its real categories) and
  // its impact on each stage after it (their real leak figures) — the chain
  // relationship, priced from the same findings, never a modelled number.
  const CAT_NAME: Record<string, string> = {
    payment_terms: 'Payment terms', price_variance: 'Price variance', supplier_risk: 'Supplier risk',
    duplicate_payment: 'Duplicate payments', reconciliation: 'Reconciliation', process_issue: 'Process issues',
    payroll_anomaly: 'Payroll anomalies', data_issue: 'Data issues', inventory_variance: 'Inventory variance',
    dead_stock: 'Dead stock', fraud_risk: 'Fraud risk', security_risk: 'Security risk',
  };
  const stageRows = (s: (typeof stages)[number]) =>
    s.sum?.cats.length
      ? [...s.sum.cats].sort((a, b) => b.valueZar - a.valueZar).map((c) => ({
          label: CAT_NAME[c.key] ?? c.label,
          value: c.valueZar > 0 ? money(c.valueZar) : '—',
          sub: `${c.count} finding${c.count === 1 ? '' : 's'}`,
        }))
      : undefined;
  // Stage health chip: first bucket with a live dimension speaks for the stage.
  // improving/declining come from the health engine verbatim; anything else is flat.
  const stageTrend = (buckets: string[]) => {
    if (!health) return undefined;
    for (const b of buckets) {
      const d = health.dims[BUCKET_DIM[b] ?? ''];
      if (d) {
        const dir = d.trend === 'improving' ? 'up' as const : d.trend === 'declining' ? 'down' as const : 'flat' as const;
        return { dir, score: Math.round(d.score), delta: d.delta };
      }
    }
    return undefined;
  };

  const stageDownstream = (i: number) => {
    const after = stages.slice(i + 1).filter((d) => d.sum);
    return after.length
      ? after.map((d) => ({
          label: d.label,
          value: d.sum!.count > 0 && d.sum!.valueZar === 0 ? '—' : money(d.sum!.valueZar),
          sub: d.sum!.count > 0 ? `${d.sum!.count} finding${d.sum!.count === 1 ? '' : 's'} exposed` : 'running clean',
        }))
      : undefined;
  };

  // Sealed tiles get receipt lines: what the booked figure is made of.
  // Absent breakdown → no rows, never a fabricated split.
  const recRows = recovered?.bySource?.length
    ? [...recovered.bySource].sort((a, b) => b.zar - a.zar).map((s) => ({
        label: s.label === 'manual' ? 'Manual uploads' : s.label,
        value: money(s.zar),
        sub: `${Math.round(s.share * 100)}% of recovered · ${s.records} records read`,
      }))
    : undefined;
  const gateRows = gate?.pending?.length
    ? gate.pending.map((p) => ({
        label: p.label,
        value: p.valueZar > 0 ? money(p.valueZar) : '—',
        sub: p.type.replace(/_/g, ' '),
      }))
    : undefined;
  const reversedRows = gate?.rejectedCount != null
    ? [
        { label: 'Rejected at the gate', value: money(gate.rejectedZar ?? 0), sub: `${gate.rejectedCount} decision${gate.rejectedCount === 1 ? '' : 's'}` },
        { label: 'Failed in execution', value: money(gate.failedZar ?? 0), sub: `${gate.failedCount ?? 0} action${gate.failedCount === 1 ? '' : 's'}` },
      ]
    : undefined;

  const nodes: RiverNode[] = [
    {
      id: 'macro', x: 0.085, y: 0.17, kicker: 'Macro & market',
      value: macro ? `${macro.count} signal${macro.count === 1 ? '' : 's'}` : '—',
      sub: macro?.signals[0]?.title,
      tag: 'External', cls: 'stage',
      prov: 'External signals read live from the radar feed — market, regulatory, and supplier pressure outside your walls. A dash means the radar has not reported.',
      rows: macro?.signals.length
        ? macro.signals.map((sg) => ({
            label: sg.title,
            value: `${Math.round(sg.relevance * 100)}% relevant`,
            sub: [sg.source, sg.sentiment].filter(Boolean).join(' · '),
          }))
        : undefined,
      downstream: stageDownstream(-1),
    },
    ...stages.map((s, i): RiverNode => ({
      id: s.id, x: s.x, y: 0.17, kicker: s.label,
      value: s.sum ? (s.sum.count > 0 && s.sum.valueZar === 0 ? '—' : money(s.sum.valueZar)) : '—',
      sub: stageSub(s.sum),
      cls: s.sum ? (s.sum.count > 0 ? 'stage leaky' : 'stage clean') : 'stage',
      trend: stageTrend(s.buckets),
      anchor: 'leaks', prov: PROV_FINDING,
      rows: stageRows(s), downstream: stageDownstream(i),
    })),
    { id: 'leak', x: 0.14, y: 0.50, kicker: est ? 'Estimated leakage' : 'Leakage detected', value: money(ops?.totalZar ?? null), tag: 'Internal', sub: leakSub, rows: leakRows.length ? leakRows : undefined, anchor: 'leaks', prov: PROV_FINDING },
    { id: 'recovered', x: 0.86, y: 0.48, kicker: 'Recovered', value: money(recovered?.zar ?? null), tone: recovered ? 'gold' : 'none', tag: 'External', sub: recSub, rows: recRows, anchor: 'ledger', sealed: true, prov: PROV_BOOKED },
    { id: 'gate', x: 0.5, y: 0.8, kicker: 'Awaiting signature', value: money(gate?.pendingZar ?? null), tag: canApprove ? 'Your call' : 'Internal', sub: gate ? `${gate.pendingCount} decision${gate.pendingCount === 1 ? '' : 's'} open · now` : undefined, rows: gateRows, anchor: 'decisions', sealed: true, prov: PROV_BOOKED },
    { id: 'review', x: 0.82, y: 0.87, kicker: 'In review', value: money(gate?.reviewZar ?? null), tag: 'Internal', sub: gate ? `${gate.reviewCount} previewed, not dispatched` : undefined, anchor: 'decisions', sealed: true, prov: PROV_BOOKED },
    { id: 'reversed', x: 0.24, y: 0.87, kicker: 'Rejected or failed', value: money(gate?.reversedZar ?? null), tone: gate && gate.reversedZar > 0 ? 'bad' : 'none', tag: 'Mixed', sub: gate ? `${gate.reversedCount} rejected (yours) or failed · all-time` : undefined, rows: reversedRows, anchor: 'decisions', sealed: true, prov: PROV_BOOKED },
  ];

  // Per-zone width normalization: a global max let the all-time recovered figure
  // (100× a stage) floor every stage edge to a hairline AND implied a false
  // money-conservation across scopes. Each zone is normalized to its own max,
  // widths via sqrt so small flows stay visible, and the leak→recovered bridge
  // is a thin dashed connector — it connects scopes, it doesn't claim the
  // leak "became" the all-time recovery.
  const stageMax = Math.max(1, ...stages.map((s) => s.sum?.valueZar ?? 0));
  const queueMax = Math.max(1, gate?.pendingZar ?? 0, gate?.reviewZar ?? 0, gate?.reversedZar ?? 0);

  const edge = (from: string, to: string, v: number | null, colorVar: string, zoneMax: number, pool?: boolean): RiverEdge => {
    const norm = v == null ? null : Math.sqrt(Math.min(1, v / zoneMax));
    const amt = norm == null ? 0.14 : Math.max(0.16, Math.min(1, 0.16 + norm * 0.84));
    const particles = v == null || v === 0 ? 0 : Math.max(2, Math.min(9, Math.round(amt * 9)));
    return { from, to, amt, colorVar, particles, pool, dashed: v == null || undefined };
  };

  const edges: RiverEdge[] = [
    // external pressure into the chain: dashed — macro signals are context,
    // not a money flow, so the pipe never claims an amount
    { from: 'macro', to: stages[0].id, amt: 0.18, colorVar: '--f-revw', particles: macro && macro.count > 0 ? 2 : 0, dashed: true },
    // thin grey process chain along the value chain
    ...stages.slice(1).map((s, i): RiverEdge => ({
      from: stages[i].id, to: s.id, amt: 0.18, colorVar: '--f-revw', particles: ops ? 2 : 0,
    })),
    // each leaking stage feeds the hub
    ...stages.filter((s) => (s.sum?.valueZar ?? 0) > 0).map((s) => edge(s.id, 'leak', s.sum!.valueZar, '--f-leak', stageMax)),
    // bridge between scopes: thin dashed connector — what's signed at the gate
    // eventually lands at the all-time terminal, but pending-now is NOT
    // recovered-yet, so the pipe never claims a flow or an amount
    { from: 'gate', to: 'recovered', amt: 0.2, colorVar: '--f-rec', particles: recovered && recovered.zar > 0 ? 2 : 0, dashed: true },
    edge('leak', 'gate', gate?.pendingZar ?? null, '--f-gate', queueMax, true),
    edge('leak', 'review', gate?.reviewZar ?? null, '--f-revw', queueMax),
    edge('leak', 'reversed', gate?.reversedZar ?? null, '--f-rev', queueMax),
  ];

  const dim = DIM[focus];
  // persona lens: on the full view, stages outside the persona's remit grey out
  const offBand = (id: string) => {
    if (!opsFirst.length || (focus !== 'brief' && focus !== 'all')) return false;
    const stage = stages.find((s) => s.id === id);
    return !!stage && !stage.buckets.some((b) => opsFirst.includes(b));
  };
  nodes.forEach((n) => { if (dim(n.id) || offBand(n.id)) n.dim = true; });
  edges.forEach((e) => { if (dim(e.from) || dim(e.to)) e.dim = true; });

  return { nodes, edges };
}
