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
      particles: 2,
    })),
  };
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
