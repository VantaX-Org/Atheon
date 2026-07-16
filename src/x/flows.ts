// The river beyond the reactor — small graph builders that put the same
// flowing-value identity on every surface. Honesty law: ambient rivers carry
// labels only; any number shown is a real config or API count, never money
// invented for decoration.
import type { RiverEdge, RiverNode } from './river';

export interface RiverGraph {
  nodes: RiverNode[];
  edges: RiverEdge[];
}

// The journey the product sells: Connect → Detect → Fix → Recover → Report.
// Order is real (it is the pipeline), so the numbered kickers carry meaning.
// No figures — this river shows the shape of the system, not its ledger.
export function journeyRiver(): RiverGraph {
  const steps: Array<{ id: string; label: string; sub: string; y: number; tone?: 'gold' }> = [
    { id: 'connect', label: 'Connect', sub: 'your ERP & systems', y: 0.3 },
    { id: 'detect', label: 'Detect', sub: 'price every leak', y: 0.62 },
    { id: 'fix', label: 'Fix', sub: 'at the source', y: 0.3 },
    { id: 'recover', label: 'Recover', sub: 'cash returns', y: 0.62, tone: 'gold' },
    { id: 'report', label: 'Report', sub: 'sealed receipts', y: 0.3 },
  ];
  // grey in, amber where leaks surface, green where money returns, blue to the board
  const colors = ['--f-revw', '--f-leak', '--f-rec', '--f-gate'];
  return {
    nodes: steps.map((s, i) => ({
      id: s.id,
      x: 0.07 + i * (0.86 / (steps.length - 1)),
      y: s.y,
      kicker: `0${i + 1}`,
      value: s.label,
      sub: s.sub,
      tone: s.tone,
    })),
    edges: steps.slice(1).map((s, i) => ({
      from: steps[i].id,
      to: s.id,
      amt: 0.5,
      colorVar: colors[i],
      particles: 3,
    })),
  };
}

// Console navigation — one node per admin group the current role can see.
// Values are the real section counts; click routes to the group's first section.
export function consoleNavRiver(
  groups: Array<{ key: string; title: string; sections: number }>,
  activeKey?: string | null,
): RiverGraph {
  const span = Math.max(groups.length - 1, 1);
  return {
    nodes: groups.map((g, i) => ({
      id: g.key,
      x: 0.06 + i * (0.88 / span),
      y: i % 2 ? 0.64 : 0.3,
      kicker: g.title,
      value: String(g.sections),
      sub: g.sections === 1 ? 'section' : 'sections',
      tone: g.key === activeKey ? 'gold' : 'none',
    })),
    edges: groups.slice(1).map((g, i) => ({
      from: groups[i].key,
      to: g.key,
      amt: 0.35,
      colorVar: '--f-gate',
      // static brand mark: section counts are not money, so nothing flows
      particles: 0,
    })),
  };
}

// Decisions strip: the gate as a river. Confirmed leakage pools at the
// signature gate; what got signed flows on and collects. Both figures are real
// sums from the actions API — null renders em-dash and a static thread.
export function decisionsRiver(
  pending: { count: number; zar: number } | null,
  collectedWeek: { count: number; zar: number } | null,
  canApprove: boolean,
  money: (v: number | null) => string,
): RiverGraph {
  return {
    nodes: [
      {
        id: 'waiting', x: 0.1, y: 0.34, kicker: 'Confirmed & waiting',
        value: money(pending?.zar ?? null), tag: 'Internal',
        sub: pending ? `${pending.count} decision${pending.count === 1 ? '' : 's'} open` : undefined,
      },
      {
        id: 'gate', x: 0.5, y: 0.62, kicker: 'Your signature',
        value: pending ? String(pending.count) : '—', tag: canApprove ? 'Your call' : 'Internal',
        sub: pending ? 'sign below to release' : undefined,
      },
      {
        id: 'collected', x: 0.88, y: 0.34, kicker: 'Collected this week',
        value: money(collectedWeek?.zar ?? null), tag: 'External',
        tone: collectedWeek && collectedWeek.zar > 0 ? 'gold' : 'none',
        sub: collectedWeek ? `${collectedWeek.count} action${collectedWeek.count === 1 ? '' : 's'} completed` : undefined,
      },
    ],
    edges: [
      {
        from: 'waiting', to: 'gate', amt: pending && pending.zar > 0 ? 0.6 : 0.14,
        colorVar: '--f-gate', particles: pending && pending.zar > 0 ? 5 : 0, pool: true,
      },
      {
        from: 'gate', to: 'collected', amt: collectedWeek && collectedWeek.zar > 0 ? 0.5 : 0.14,
        colorVar: '--f-rec', particles: collectedWeek && collectedWeek.zar > 0 ? 4 : 0,
      },
    ],
  };
}

// Ledger: recovery accumulating month by month into TO DATE. Only booked
// receipts (completed actions) feed it; each month node carries that month's
// booked sum. The terminal prefers the tenant-wide summary total (authoritative,
// never truncated); the listed page only shapes the month bars. No receipts
// renders one thin static thread with an em-dash terminal — never invented.
export function ledgerRiver(
  receipts: Array<{ completed_at?: string | null; value_zar?: number | null }> | null,
  money: (v: number | null) => string,
  totals?: { count: number; zar: number } | null,
): RiverGraph {
  const booked = (receipts ?? []).filter((r) => r.completed_at && r.value_zar != null);
  if (booked.length === 0) {
    return {
      nodes: [
        { id: 'in', x: 0.04, y: 0.5, kicker: '', value: '' },
        {
          id: 'todate', x: 0.9, y: 0.5, kicker: 'To date',
          value: totals && totals.zar > 0 ? money(totals.zar) : '—',
          sub: totals && totals.count > 0 ? `${totals.count} completed action${totals.count === 1 ? '' : 's'}` : 'no booked receipts yet',
          tag: 'External',
        },
      ],
      edges: [{ from: 'in', to: 'todate', amt: 0.12, colorVar: '--f-rec', particles: 0 }],
    };
  }

  const byMonth = new Map<string, number>();
  for (const r of booked) {
    const d = new Date(r.completed_at!);
    const k = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + r.value_zar!);
  }
  // last 6 months with bookings, oldest first; the terminal carries the full total
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const total = totals?.zar ?? booked.reduce((s, r) => s + r.value_zar!, 0);
  const count = totals?.count ?? booked.length;
  const label = (k: string) => {
    const [y, m] = k.split('-').map(Number);
    return new Date(y, m, 1).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
  };

  let cum = Math.max(0, total - months.reduce((s, [, v]) => s + v, 0)); // bookings older than the window
  const span = Math.max(months.length, 1);
  const nodes: RiverNode[] = months.map(([k, v], i) => ({
    id: k,
    x: 0.06 + i * (0.68 / span),
    y: i % 2 ? 0.62 : 0.36,
    kicker: label(k),
    value: money(v),
    sub: 'booked this month',
    tag: 'External',
  }));
  nodes.push({
    id: 'todate', x: 0.9, y: 0.48, kicker: 'To date', value: money(total),
    sub: `${count} sealed receipt${count === 1 ? '' : 's'}`, tone: 'gold', tag: 'External',
  });

  const edges: RiverEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    cum += months[i][1];
    const amt = Math.max(0.18, Math.min(1, Math.sqrt(cum / Math.max(total, 1))));
    edges.push({
      from: nodes[i].id, to: nodes[i + 1].id, amt, colorVar: '--f-rec',
      particles: Math.max(1, Math.min(6, Math.round(amt * 6))),
    });
  }
  return { nodes, edges };
}

// Catalyst card mini — canvas-only (empty kicker skips the tile), so the card
// keeps its own stats and the river is pure motion. Flow strength and
// particles derive from the cluster's real realized value; a null or zero
// ledger renders a static thin thread, never a lively fake.
export function catalystMiniRiver(
  v: { realized: number; runs: number } | null,
  maxRealized: number,
): RiverGraph {
  const amt = v ? Math.max(0.15, Math.min(1, v.realized / Math.max(1, maxRealized))) : 0.12;
  return {
    nodes: [
      { id: 'in', x: 0.03, y: 0.5, kicker: '', value: '' },
      { id: 'real', x: 0.97, y: 0.3, kicker: '', value: '' },
      { id: 'runs', x: 0.97, y: 0.72, kicker: '', value: '' },
    ],
    edges: [
      {
        from: 'in',
        to: 'real',
        amt,
        colorVar: '--f-rec',
        particles: v && v.realized > 0 ? Math.max(1, Math.min(3, Math.round(amt * 3))) : 0,
      },
      {
        from: 'in',
        to: 'runs',
        amt: v && v.runs > 0 ? 0.25 : 0.12,
        colorVar: '--f-gate',
        particles: v && v.runs > 0 ? 1 : 0,
      },
    ],
  };
}
