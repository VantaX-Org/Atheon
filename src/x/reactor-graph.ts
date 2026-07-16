// Builds the reactor river graph: WORLD (external signals) → THE BUSINESS →
// operations → leakage → decision gate → recovered, flowing back to the hub.
// Honesty law: a null section renders em-dash nodes and static (0-particle)
// edges — never a fabricated zero. Fee/ROI never appear here (Ledger only).

import { formatCompactCurrency } from '@/lib/format-currency';
import type { RiverEdge, RiverNode } from './river';

export type SectionKey = 'brief' | 'decisions' | 'ledger' | 'catalysts';
export type ReactorFocus = SectionKey | 'all';

export interface ReactorInput {
  world: { headwinds: number; tailwinds: number; regulatoryDeadlines: number; signalCount: number } | null;
  health: { score: number; benchmark: number | null } | null;
  connections: { total: number; broken: number } | null;
  ops: { categories: Array<{ key: string; label: string; count: number; valueZar: number }>; totalZar: number; totalCount: number } | null;
  gate: { pendingCount: number; pendingZar: number; reviewCount: number; reviewZar: number; reversedCount: number; reversedZar: number } | null;
  recovered: { zar: number } | null;
}

const DIM: Record<ReactorFocus, (id: string) => boolean> = {
  all: () => false,
  brief: (id) => ['gate', 'review', 'reversed', 'recovered'].includes(id),
  decisions: (id) => ['tailwinds', 'headwinds', 'regulatory', 'hub'].includes(id) || id.startsWith('ops'),
  ledger: (id) => ['tailwinds', 'headwinds', 'regulatory', 'review'].includes(id) || id.startsWith('ops'),
  catalysts: (id) => ['tailwinds', 'headwinds', 'regulatory', 'recovered'].includes(id),
};

export function buildReactorGraph(input: ReactorInput, currency: string, focus: ReactorFocus): { nodes: RiverNode[]; edges: RiverEdge[] } {
  const { world, health, ops, gate, recovered } = input;
  const money = (v: number | null) => formatCompactCurrency(v, currency);
  const count = (v: number | null) => (v == null ? '—' : String(v));

  // top 5 categories by value, rest folded into Other
  let cats: Array<{ key: string; label: string; count: number; valueZar: number }> = [];
  if (ops && ops.categories.length) {
    const sorted = [...ops.categories].sort((a, b) => b.valueZar - a.valueZar);
    cats = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    if (rest.length)
      cats.push({
        key: 'other', label: 'Other',
        count: rest.reduce((s, c) => s + c.count, 0),
        valueZar: rest.reduce((s, c) => s + c.valueZar, 0),
      });
  }

  const nodes: RiverNode[] = [
    { id: 'tailwinds', x: 0.05, y: 0.14, kicker: 'Tailwinds', value: count(world?.tailwinds ?? null), tone: world ? 'ok' : 'none', anchor: 'brief' },
    { id: 'headwinds', x: 0.05, y: 0.40, kicker: 'Headwinds', value: count(world?.headwinds ?? null), tone: world ? 'bad' : 'none', anchor: 'brief' },
    { id: 'regulatory', x: 0.05, y: 0.66, kicker: 'Regulatory', value: count(world?.regulatoryDeadlines ?? null), tone: world ? 'warn' : 'none', anchor: 'brief' },
    {
      id: 'hub', x: 0.27, y: 0.40, kicker: 'The business',
      value: health ? String(health.score) : '—', tone: 'none', anchor: 'brief',
      sub: health?.benchmark != null ? `vs industry ${health.benchmark}` : undefined,
    },
    ...(cats.length
      ? cats.map((c, i) => ({
          id: `ops-${c.key}`, x: 0.48,
          y: cats.length === 1 ? 0.48 : 0.10 + i * (0.76 / (cats.length - 1)),
          kicker: c.label, value: money(c.valueZar),
          tone: (c.valueZar > 0 ? 'bad' : 'none') as RiverNode['tone'],
          sub: `${c.count} findings`, anchor: 'brief',
        }))
      : [{ id: 'ops', x: 0.48, y: 0.48, kicker: 'Operations', value: '—', tone: 'none' as const, anchor: 'brief' }]),
    { id: 'leak', x: 0.66, y: 0.28, kicker: 'Leakage detected', value: money(ops?.totalZar ?? null), tone: ops ? 'bad' : 'none', sub: ops ? `${ops.totalCount} findings` : undefined, anchor: 'brief' },
    { id: 'gate', x: 0.66, y: 0.56, kicker: 'Awaiting decision', value: money(gate?.pendingZar ?? null), tone: 'none', sub: gate ? `${gate.pendingCount} actions` : undefined, anchor: 'decisions' },
    { id: 'review', x: 0.66, y: 0.74, kicker: 'In review', value: money(gate?.reviewZar ?? null), tone: 'none', sub: gate ? `${gate.reviewCount} actions` : undefined, anchor: 'decisions' },
    { id: 'reversed', x: 0.66, y: 0.88, kicker: 'Reversed', value: money(gate?.reversedZar ?? null), tone: gate && gate.reversedZar > 0 ? 'bad' : 'none', anchor: 'decisions' },
    { id: 'recovered', x: 0.88, y: 0.30, kicker: 'Recovered', value: money(recovered?.zar ?? null), tone: recovered ? 'gold' : 'none', anchor: 'ledger' },
  ];

  // amt normalized against the largest money figure on screen
  const moneyVals = [ops?.totalZar, gate?.pendingZar, gate?.reviewZar, gate?.reversedZar, recovered?.zar, ...cats.map((c) => c.valueZar)]
    .filter((v): v is number => v != null);
  const maxMoney = Math.max(1, ...moneyVals);
  const worldMax = world ? Math.max(1, world.tailwinds, world.headwinds, world.regulatoryDeadlines) : 1;

  const edge = (from: string, to: string, v: number | null, max: number, colorVar: string, pool?: boolean): RiverEdge => {
    const amt = v == null ? 0.12 : Math.max(0.12, Math.min(1, v / max));
    const particles = v == null || v === 0 ? 0 : Math.max(1, Math.min(4, Math.round(amt * 4)));
    return { from, to, amt, colorVar, particles, pool };
  };

  const edges: RiverEdge[] = [
    edge('tailwinds', 'hub', world?.tailwinds ?? null, worldMax, '--ok'),
    edge('headwinds', 'hub', world?.headwinds ?? null, worldMax, '--bad'),
    edge('regulatory', 'hub', world?.regulatoryDeadlines ?? null, worldMax, '--warn'),
    ...(cats.length
      ? cats.flatMap((c) => [
          edge('hub', `ops-${c.key}`, c.valueZar, maxMoney, '--f-revw'),
          edge(`ops-${c.key}`, 'leak', c.valueZar, maxMoney, '--f-leak'),
        ])
      : [edge('hub', 'ops', null, maxMoney, '--f-revw'), edge('ops', 'leak', null, maxMoney, '--f-leak')]),
    edge('leak', 'gate', gate?.pendingZar ?? null, maxMoney, '--f-gate', true),
    edge('leak', 'review', gate?.reviewZar ?? null, maxMoney, '--f-revw'),
    edge('gate', 'reversed', gate?.reversedZar ?? null, maxMoney, '--f-rev'),
    edge('gate', 'recovered', recovered?.zar ?? null, maxMoney, '--f-rec'),
    edge('recovered', 'hub', recovered?.zar ?? null, maxMoney, '--f-rec'),
  ];

  const dim = DIM[focus];
  nodes.forEach((n) => { if (dim(n.id)) n.dim = true; });
  edges.forEach((e) => { if (dim(e.from) || dim(e.to)) e.dim = true; });

  return { nodes, edges };
}
