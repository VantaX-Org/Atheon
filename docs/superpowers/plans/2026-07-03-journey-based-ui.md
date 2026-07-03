# Journey-Based UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize Atheon around the value loop (Connect → Detect → Fix → Recover → Report): a new JourneyHome replaces the widget-wall Dashboard, two thin stage pages (`/data`, `/findings`) give the loop canonical doors, and the sidebar becomes a plain-language journey nav.

**Architecture:** Pure stage-model logic in `src/lib/journey.ts` (unit-tested), presentational `JourneySpine`/`JourneyStageBar` components, thin pages composed from existing components (`ActionQueuePanel`, `FindingsReviewTable`) and existing API endpoints. No theme changes, no new dependencies, no API changes.

**Tech Stack:** React 18 + TypeScript, react-router-dom v6, Tailwind + CSS-variable tokens (existing), Zustand (`useAppStore`), vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-03-journey-based-ui-design.md`

## Global Constraints

- **No re-theme.** Only existing tokens/classes (`var(--accent)`, `t-muted`, `text-label`, `Card`, Space Mono micro-labels). Never introduce new colors.
- **RAG only for status/health** — green `var(--pos)`-family healthy, amber watch, red at-risk. Accent royal-blue = brand/active only.
- **Labels-only renames.** Routes and code identifiers keep "catalyst" etc. Nav/page copy says "Fixes".
- **Honest numbers.** Exposure headline = `findings_summary.total_value_at_risk_zar` (confidence-gated). `potential_unverified_zar` shown separately or not at all — never in a headline. Fetch failure renders an em-dash `—`, never a fabricated 0 or blocked page.
- **Currency:** format with existing `formatCompactCurrency(value, currency)` from `@/lib/format-currency`; currency from `useTenantCurrency()` (`@/stores/appStore`).
- **No new npm dependencies.** Relative time via `date-fns` `formatDistanceToNow` (already installed).
- Commands: `npx vitest run <file>` for tests, `npx tsc -b` for typecheck, `npm run build` for full build.
- Commit after every task with the exact message given. Do not push.

---

### Task 1: Journey stage model + JourneySpine + JourneyStageBar

**Files:**
- Create: `src/lib/journey.ts`
- Create: `src/lib/__tests__/journey.test.ts`
- Create: `src/components/journey/JourneySpine.tsx`
- Create: `src/components/journey/JourneyStageBar.tsx`

**Interfaces:**
- Consumes: `formatCompactCurrency` from `@/lib/format-currency`; `Card` from `@/components/ui/card`; `cn` from `@/lib/utils`.
- Produces (later tasks import these exactly):
  - `type StageKey = 'connect' | 'detect' | 'fix' | 'recover' | 'report'`
  - `interface StageInput { connections: { total: number; broken: number } | null; exposure: { openValueZar: number; findingCount: number } | null; fixes: { pendingCount: number; pendingValueZar: number } | null; savings: { recoveredZar: number; roiMultiple: number } | null }`
  - `interface JourneyStage { key: StageKey; label: string; route: string; headline: string | null; sub: string | null; rag: 'green' | 'amber' | 'red' | 'none'; cta: string; current: boolean }`
  - `function buildJourneyStages(input: StageInput, currency: string): JourneyStage[]` (always returns exactly 5, exactly one `current: true`)
  - `const STAGE_ROUTES: Record<StageKey, string>`
  - `function JourneySpine({ stages }: { stages: JourneyStage[] }): JSX.Element`
  - `function JourneyStageBar({ current }: { current: StageKey }): JSX.Element`

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/journey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildJourneyStages, type StageInput } from '@/lib/journey';

const base: StageInput = {
  connections: { total: 3, broken: 0 },
  exposure: { openValueZar: 4_200_000, findingCount: 12 },
  fixes: { pendingCount: 0, pendingValueZar: 0 },
  savings: { recoveredZar: 160_644_105, roiMultiple: 12.4 },
};

describe('buildJourneyStages', () => {
  it('returns 5 stages in loop order with exactly one current', () => {
    const stages = buildJourneyStages(base, 'ZAR');
    expect(stages.map((s) => s.key)).toEqual(['connect', 'detect', 'fix', 'recover', 'report']);
    expect(stages.filter((s) => s.current)).toHaveLength(1);
  });

  it('fresh tenant: no connections → connect is current, nothing red', () => {
    const stages = buildJourneyStages(
      { connections: { total: 0, broken: 0 }, exposure: null, fixes: null, savings: null },
      'ZAR',
    );
    expect(stages[0].current).toBe(true);
    expect(stages.every((s) => s.rag !== 'red')).toBe(true);
  });

  it('connected but no findings yet → detect is current', () => {
    const stages = buildJourneyStages(
      { ...base, exposure: { openValueZar: 0, findingCount: 0 }, fixes: { pendingCount: 0, pendingValueZar: 0 }, savings: { recoveredZar: 0, roiMultiple: 0 } },
      'ZAR',
    );
    expect(stages.find((s) => s.key === 'detect')!.current).toBe(true);
  });

  it('pending approvals → fix is current and amber', () => {
    const stages = buildJourneyStages(
      { ...base, fixes: { pendingCount: 4, pendingValueZar: 900_000 } },
      'ZAR',
    );
    const fix = stages.find((s) => s.key === 'fix')!;
    expect(fix.current).toBe(true);
    expect(fix.rag).toBe('amber');
  });

  it('healthy mature tenant → report is current', () => {
    const stages = buildJourneyStages(base, 'ZAR');
    expect(stages.find((s) => s.key === 'report')!.current).toBe(true);
  });

  it('broken connection → connect stage is red', () => {
    const stages = buildJourneyStages(
      { ...base, connections: { total: 3, broken: 1 } },
      'ZAR',
    );
    expect(stages[0].rag).toBe('red');
  });

  it('failed fetches → em-dash headlines (null), never zero', () => {
    const stages = buildJourneyStages(
      { connections: null, exposure: null, fixes: null, savings: null },
      'ZAR',
    );
    for (const s of stages) expect(s.headline).toBeNull();
  });

  it('formats exposure headline compactly in tenant currency', () => {
    const detect = buildJourneyStages(base, 'ZAR').find((s) => s.key === 'detect')!;
    expect(detect.headline).toMatch(/R/); // formatCompactCurrency ZAR
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/journey.test.ts`
Expected: FAIL — cannot resolve `@/lib/journey`.

- [ ] **Step 3: Implement `src/lib/journey.ts`**

```ts
/**
 * Journey stage model — the five-stage value loop the whole UI hangs off:
 *   CONNECT → DETECT → FIX → RECOVER → REPORT
 * Pure functions only (no fetching, no React) so the current-stage and RAG
 * rules are unit-testable. See docs/superpowers/specs/2026-07-03-journey-based-ui-design.md §3.
 */
import { formatCompactCurrency } from '@/lib/format-currency';

export type StageKey = 'connect' | 'detect' | 'fix' | 'recover' | 'report';
export type StageRag = 'green' | 'amber' | 'red' | 'none';

export interface StageInput {
  /** null = fetch failed (render em-dash, make no claims) */
  connections: { total: number; broken: number } | null;
  exposure: { openValueZar: number; findingCount: number } | null;
  fixes: { pendingCount: number; pendingValueZar: number } | null;
  savings: { recoveredZar: number; roiMultiple: number } | null;
}

export interface JourneyStage {
  key: StageKey;
  label: string;
  route: string;
  /** Pre-formatted big number; null renders an em-dash. */
  headline: string | null;
  sub: string | null;
  rag: StageRag;
  cta: string;
  current: boolean;
}

export const STAGE_ROUTES: Record<StageKey, string> = {
  connect: '/data',
  detect: '/findings',
  fix: '/catalysts',
  recover: '/roi-dashboard',
  report: '/executive-summary',
};

export const STAGE_LABELS: Record<StageKey, string> = {
  connect: 'Data',
  detect: 'Findings',
  fix: 'Fixes',
  recover: 'Savings',
  report: 'Reports',
};

/** First stage with outstanding work; a healthy loop lands on REPORT. */
function currentStage(i: StageInput): StageKey {
  if (!i.connections || i.connections.total === 0) return 'connect';
  if (!i.exposure || i.exposure.findingCount === 0) return 'detect';
  if (i.fixes && i.fixes.pendingCount > 0) return 'fix';
  if (!i.savings || i.savings.recoveredZar === 0) return 'recover';
  return 'report';
}

export function buildJourneyStages(input: StageInput, currency: string): JourneyStage[] {
  const cur = currentStage(input);
  const money = (v: number) => formatCompactCurrency(v, currency);
  const { connections, exposure, fixes, savings } = input;

  const stages: Omit<JourneyStage, 'current'>[] = [
    {
      key: 'connect',
      label: STAGE_LABELS.connect,
      route: STAGE_ROUTES.connect,
      headline: connections ? String(connections.total) : null,
      sub: connections ? (connections.total === 1 ? 'source connected' : 'sources connected') : null,
      rag: !connections ? 'none' : connections.broken > 0 ? 'red' : connections.total > 0 ? 'green' : 'none',
      cta: connections && connections.total > 0 ? 'View data' : 'Connect your data',
    },
    {
      key: 'detect',
      label: STAGE_LABELS.detect,
      route: STAGE_ROUTES.detect,
      headline: exposure ? money(exposure.openValueZar) : null,
      sub: exposure ? `${exposure.findingCount} open finding${exposure.findingCount === 1 ? '' : 's'}` : null,
      rag: !exposure ? 'none' : exposure.openValueZar > 0 ? 'amber' : 'green',
      cta: 'Review findings',
    },
    {
      key: 'fix',
      label: STAGE_LABELS.fix,
      route: STAGE_ROUTES.fix,
      headline: fixes ? String(fixes.pendingCount) : null,
      sub: fixes
        ? fixes.pendingCount > 0
          ? `awaiting approval · ${money(fixes.pendingValueZar)}`
          : 'awaiting approval'
        : null,
      rag: !fixes ? 'none' : fixes.pendingCount > 0 ? 'amber' : 'green',
      cta: fixes && fixes.pendingCount > 0 ? 'Approve fixes' : 'View fixes',
    },
    {
      key: 'recover',
      label: STAGE_LABELS.recover,
      route: STAGE_ROUTES.recover,
      headline: savings ? money(savings.recoveredZar) : null,
      sub: savings && savings.roiMultiple > 0 ? `recovered · ${savings.roiMultiple.toFixed(1)}× ROI` : savings ? 'recovered' : null,
      rag: !savings ? 'none' : savings.recoveredZar > 0 ? 'green' : 'none',
      cta: 'See savings proof',
    },
    {
      key: 'report',
      label: STAGE_LABELS.report,
      route: STAGE_ROUTES.report,
      headline: null, // no honest "last report" source yet — CTA-only card (spec §4 deviation noted)
      sub: 'executive & board',
      rag: 'none',
      cta: 'View reports',
    },
  ];

  return stages.map((s) => ({ ...s, current: s.key === cur }));
}
```

Note: the `report` card is CTA-only (headline `null`) — there is no reliable "last report generated" endpoint; showing nothing is honest, fabricating a date is not. The test suite's "failed fetches" case stays valid because all five headlines are null when every input is null.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/journey.test.ts`
Expected: PASS (8 tests). If `formatCompactCurrency('ZAR')` output doesn't start with "R", read `src/lib/format-currency.ts` and adjust the regex in the last test to the real prefix — do not change the implementation to force a prefix.

- [ ] **Step 5: Create `src/components/journey/JourneySpine.tsx`**

```tsx
/**
 * JourneySpine — the five-stage value loop as a row of stage cards.
 * Home's centerpiece: one number, one RAG dot, one CTA per stage.
 * Current stage carries the 3px royal-blue left rule (existing active language).
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { JourneyStage } from '@/lib/journey';

const MONO = "'Space Mono', ui-monospace, monospace";

const RAG_COLOR: Record<JourneyStage['rag'], string | null> = {
  green: 'var(--pos, #1a7d4f)',
  amber: 'var(--warning, #d98a00)',
  red: 'var(--neg, #c0392b)',
  none: null,
};

export function JourneySpine({ stages }: { stages: JourneyStage[] }) {
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Your journey">
      {stages.map((s, i) => {
        const dot = RAG_COLOR[s.rag];
        return (
          <li key={s.key} className="relative">
            <Link to={s.route} aria-current={s.current ? 'step' : undefined} className="block h-full group">
              <Card
                className={cn('relative h-full p-4 transition-colors', s.current ? '' : 'opacity-90 hover:opacity-100')}
                style={s.current ? { background: 'var(--accent-subtle)' } : undefined}
              >
                {s.current && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
                <p className="flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase font-bold t-muted" style={{ fontFamily: MONO }}>
                  <span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  {s.label}
                  {dot && <span aria-hidden="true" className="ml-auto inline-block w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
                </p>
                <p className="mt-2 text-xl font-bold t-primary tabular-nums truncate">{s.headline ?? '—'}</p>
                <p className="text-caption t-muted truncate">{s.sub ?? ' '}</p>
                <p className={cn('mt-3 text-caption inline-flex items-center gap-1 font-medium', s.current ? 'text-accent' : 't-secondary group-hover:text-accent')}>
                  {s.cta} <ArrowRight size={11} aria-hidden="true" />
                </p>
              </Card>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 6: Create `src/components/journey/JourneyStageBar.tsx`**

```tsx
/**
 * JourneyStageBar — one-line loop locator under a stage page's header:
 *   DATA → FINDINGS → [FIXES] → SAVINGS → REPORTS
 * Current stage in accent; every label links to its canonical page.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { STAGE_LABELS, STAGE_ROUTES, type StageKey } from '@/lib/journey';

const ORDER: StageKey[] = ['connect', 'detect', 'fix', 'recover', 'report'];
const MONO = "'Space Mono', ui-monospace, monospace";

export function JourneyStageBar({ current }: { current: StageKey }) {
  return (
    <nav aria-label="Journey stage" className="mb-6 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {ORDER.map((key, i) => (
        <span key={key} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="t-muted text-[10px]">→</span>}
          <Link
            to={STAGE_ROUTES[key]}
            aria-current={key === current ? 'step' : undefined}
            className={cn(
              'text-[10px] tracking-[0.16em] uppercase',
              key === current ? 'font-bold text-accent' : 't-muted hover:t-secondary font-medium',
            )}
            style={{ fontFamily: MONO }}
          >
            {STAGE_LABELS[key]}
          </Link>
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b`
Expected: clean. (If `Card` doesn't accept `style`, check `src/components/ui/card.tsx` — it spreads div props in the shadcn pattern; if not, wrap the style on an inner div instead.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/journey.ts src/lib/__tests__/journey.test.ts src/components/journey/
git commit -m "feat(journey): stage model + JourneySpine + JourneyStageBar"
```

---

### Task 2: JourneyHome replaces Dashboard

**Files:**
- Create: `src/pages/JourneyHome.tsx`
- Create: `src/pages/__tests__/JourneyHome.test.tsx`
- Modify: `src/App.tsx` (swap Dashboard → JourneyHome at `/dashboard`, ~line 13 import and ~line 177 route)
- Delete: `src/pages/Dashboard.tsx`, `src/pages/dashboard/KpiCards.tsx`, `src/pages/dashboard/IntelligencePanel.tsx`, `src/components/dashboard/ExecutiveOverview.tsx`, `src/components/dashboard/WorkingCapitalCard.tsx`, `src/components/dashboard/CloseCycleCard.tsx`

**Interfaces:**
- Consumes: `buildJourneyStages`, `StageInput`, `JourneySpine` (Task 1); `api.erp.connections()`, `api.assessments.list()`, `api.assessments.get(id)`, `api.erp.actionsSummary()`, `api.roi.get()` from `@/lib/api`; `ActionQueuePanel` (`variant`, `title?`, `limit?`, `allowApprove?`) from `@/components/dashboard/ActionQueuePanel`; `useAppStore`, `useTenantCurrency` from `@/stores/appStore`; `PageHeader` from `@/components/ui/page-header`.
- Produces: `export function JourneyHome(): JSX.Element` — App.tsx renders it at `/dashboard` inside the existing `ScopedRoleRedirect`.

- [ ] **Step 1: Write the failing render test**

`src/pages/__tests__/JourneyHome.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      erp: {
        ...orig.api.erp,
        connections: vi.fn().mockResolvedValue({ connections: [{ id: 'c1', status: 'active' }], total: 1 }),
        actionsSummary: vi.fn().mockResolvedValue({ tenantId: 't1', summary: { pending_approval_count: 2, pending_approval_value_zar: 500000, completed_count: 0, completed_value_zar: 0, rejected_count: 0, rejected_value_zar: 0, failed_count: 0, failed_value_zar: 0, previewed_count: 0, previewed_value_zar: 0, total_count: 2, total_value_zar: 500000 } }),
        listAllActions: vi.fn().mockResolvedValue({ tenantId: 't1', total: 0, actions: [] }),
      },
      assessments: {
        ...orig.api.assessments,
        list: vi.fn().mockResolvedValue({ assessments: [{ id: 'a1', status: 'complete', createdAt: '2026-07-01' }] }),
        get: vi.fn().mockResolvedValue({ id: 'a1', status: 'complete', results: { findings_summary: { total_count: 12, total_value_at_risk_zar: 4200000, by_severity: {}, by_category: {}, recommended_catalysts: [] } } }),
      },
      roi: {
        ...orig.api.roi,
        get: vi.fn().mockResolvedValue({ totalDiscrepancyValueRecovered: 160000000, roiMultiple: 12.4, breakdown: { byCluster: [] } }),
      },
    },
  };
});

import { JourneyHome } from '@/pages/JourneyHome';

describe('JourneyHome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the five-stage spine', async () => {
    render(<MemoryRouter><JourneyHome /></MemoryRouter>);
    expect(await screen.findByText('Data')).toBeInTheDocument();
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText('Fixes')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('shows the needs-you-now hero when approvals are pending', async () => {
    render(<MemoryRouter><JourneyHome /></MemoryRouter>);
    expect(await screen.findByText(/awaiting your approval/i)).toBeInTheDocument();
  });
});
```

If the store demands a user for rendering, add in `beforeEach`:
`useAppStore.setState({ user: { id: 'u1', name: 'Test', email: 't@x.com', role: 'admin' } as never });` (import `useAppStore` from `@/stores/appStore`; match the store's real `user` shape — read `src/stores/appStore.ts` first).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/JourneyHome.test.tsx`
Expected: FAIL — `@/pages/JourneyHome` does not exist.

- [ ] **Step 3: Implement `src/pages/JourneyHome.tsx`**

```tsx
/**
 * JourneyHome — the front door. Answers exactly two questions:
 *   1. Where am I in the loop?  (JourneySpine: 5 stages, one number each)
 *   2. What needs me now?      (hero action + ActionQueuePanel)
 * Replaces the 12-engine widget-wall Dashboard (deleted 2026-07-03; analytics
 * live in Pulse/Apex under Workspace). Spec: 2026-07-03-journey-based-ui-design.md §4.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore, useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { buildJourneyStages, type StageInput } from '@/lib/journey';
import { JourneySpine } from '@/components/journey/JourneySpine';
import { ActionQueuePanel } from '@/components/dashboard/ActionQueuePanel';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';

function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  let g = 'Good morning';
  if (hour >= 12 && hour < 17) g = 'Good afternoon';
  if (hour >= 17) g = 'Good evening';
  return name ? `${g}, ${name}` : g;
}

export function JourneyHome() {
  const user = useAppStore((s) => s.user);
  const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [input, setInput] = useState<StageInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [conns, assessList, actions, roi] = await Promise.allSettled([
        api.erp.connections(),
        api.assessments.list(),
        api.erp.actionsSummary(),
        api.roi.get(),
      ]);

      // Exposure needs a second hop: latest complete assessment → findings_summary.
      let exposure: StageInput['exposure'] = null;
      if (assessList.status === 'fulfilled') {
        const latest = [...assessList.value.assessments]
          .filter((a) => a.status === 'complete')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        if (!latest) {
          exposure = { openValueZar: 0, findingCount: 0 };
        } else {
          try {
            const detail = await api.assessments.get(latest.id);
            const s = detail.results?.findings_summary;
            exposure = s ? { openValueZar: s.total_value_at_risk_zar, findingCount: s.total_count } : { openValueZar: 0, findingCount: 0 };
          } catch { exposure = null; }
        }
      }

      if (cancelled) return;
      setInput({
        connections: conns.status === 'fulfilled'
          ? {
              total: conns.value.total,
              broken: conns.value.connections.filter((c) => c.status === 'error' || c.status === 'failed').length,
            }
          : null,
        exposure,
        fixes: actions.status === 'fulfilled'
          ? { pendingCount: actions.value.summary.pending_approval_count, pendingValueZar: actions.value.summary.pending_approval_value_zar }
          : null,
        savings: roi.status === 'fulfilled'
          ? { recoveredZar: roi.value.totalDiscrepancyValueRecovered, roiMultiple: roi.value.roiMultiple }
          : null,
      });
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const stages = buildJourneyStages(
    input ?? { connections: null, exposure: null, fixes: null, savings: null },
    currency,
  );

  // One plain sentence locating the user in the loop.
  const parts: string[] = [];
  if (input?.connections) parts.push(`${input.connections.total} source${input.connections.total === 1 ? '' : 's'} connected`);
  if (input?.exposure) parts.push(`${formatCompactCurrency(input.exposure.openValueZar, currency)} open exposure`);
  if (input?.savings) parts.push(`${formatCompactCurrency(input.savings.recoveredZar, currency)} recovered to date`);
  const locator = parts.join(' · ');

  const pending = input?.fixes && input.fixes.pendingCount > 0 ? input.fixes : null;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Atheon · Your journey"
        title={getGreeting(user?.name?.split(' ')[0])}
        dek={locator || 'Connect your data to start the loop.'}
      />

      {mfaEnforcementWarning && (
        <Card className="mb-6 p-4 flex items-center justify-between gap-4" role="alert">
          <p className="text-caption flex items-center gap-2" style={{ color: 'var(--warning)' }}>
            <AlertTriangle size={14} aria-hidden="true" /> {mfaEnforcementWarning}
          </p>
          <Link to="/settings/mfa" className="text-caption font-medium text-accent hover:underline shrink-0">Enable MFA now</Link>
        </Card>
      )}

      <JourneySpine stages={stages} />

      <section aria-label="Needs you now" className="mt-8">
        {pending && (
          <Link to="/catalysts" className="block group mb-4">
            <Card className="p-4 flex items-center justify-between gap-4" style={{ background: 'var(--accent-subtle)' }}>
              <p className="t-primary font-medium">
                {formatCompactCurrency(pending.pendingValueZar, currency)} in {pending.pendingCount} fix{pending.pendingCount === 1 ? '' : 'es'} awaiting your approval
              </p>
              <span className="text-caption font-medium text-accent inline-flex items-center gap-1 shrink-0">
                Approve fixes <ArrowRight size={12} aria-hidden="true" />
              </span>
            </Card>
          </Link>
        )}
        <ActionQueuePanel variant="executive" limit={6} />
      </section>
    </div>
  );
}
```

Adjust the MFA banner to mirror whatever `Dashboard.tsx` currently renders for `mfaEnforcementWarning` (read it before deleting — copy its exact copy/CTA if it differs; if the store field is an object rather than a string, keep the old rendering logic verbatim).

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/pages/__tests__/JourneyHome.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Swap the route and delete the old dashboard**

In `src/App.tsx`: replace the eager import `import { Dashboard } from "@/pages/Dashboard";` with `import { JourneyHome } from "@/pages/JourneyHome";` and change the route element:

```tsx
<Route path="/dashboard" element={<ScopedRoleRedirect><JourneyHome /></ScopedRoleRedirect>} />
```

Then delete:

```bash
git rm src/pages/Dashboard.tsx src/pages/dashboard/KpiCards.tsx src/pages/dashboard/IntelligencePanel.tsx src/components/dashboard/ExecutiveOverview.tsx src/components/dashboard/WorkingCapitalCard.tsx src/components/dashboard/CloseCycleCard.tsx
```

Before deleting, run `grep -rn "KpiCards\|IntelligencePanel\|ExecutiveOverview\|WorkingCapitalCard\|CloseCycleCard\|pages/Dashboard" src e2e --include="*.ts*" | grep -v "src/pages/Dashboard.tsx" | grep -v "src/pages/dashboard/"` — any hit outside the deleted files must be fixed (verified 2026-07-03: only Dashboard.tsx imports them; `src/pages/dashboard/` may contain other files used elsewhere — delete ONLY the two listed files, and first check each for additional exports imported elsewhere). Keep `ActionQueuePanel`, `FindingsReviewTable`, `TraceabilityModal` (shared with Pulse/Apex/ExecutiveSummary).

- [ ] **Step 6: Typecheck + full unit suite**

Run: `npx tsc -b && npx vitest run`
Expected: clean build; no test references deleted files (fix any that do — e.g. update text-based e2e/unit assertions that looked for old dashboard copy).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(journey): JourneyHome front door replaces widget-wall Dashboard"
```

---

### Task 3: DataPage — canonical Connect stage (`/data`)

**Files:**
- Create: `src/pages/DataPage.tsx`
- Create: `src/pages/__tests__/DataPage.test.tsx`
- Modify: `src/App.tsx` (add lazy route)

**Interfaces:**
- Consumes: `api.erp.connections()` → `{ connections: ERPConnection[]; total }` (fields: `name`, `adapterName`, `status`, `lastSync`, `recordsSynced`); `api.assessments.list()`; `JourneyStageBar` (Task 1); `StatusPill` (`@/components/ui/status-pill`, prop `kind: StatusKind`); `PageHeader`; `formatDistanceToNow` from `date-fns`; `useAppStore` for role.
- Produces: `export default function DataPage()` (default export — matches the router's `lazyWithRetry(() => import(...))` pattern).

- [ ] **Step 1: Write the failing test**

`src/pages/__tests__/DataPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      erp: {
        ...orig.api.erp,
        connections: vi.fn().mockResolvedValue({
          total: 2,
          connections: [
            { id: 'c1', adapterId: 'sap', adapterName: 'SAP S/4HANA', adapterSystem: 'sap', adapterProtocol: 'odata', name: 'Production SAP', status: 'active', config: {}, lastSync: '2026-07-02T10:00:00Z', syncFrequency: 'daily', recordsSynced: 120000, connectedAt: '2026-01-01' },
            { id: 'c2', adapterId: 'wd', adapterName: 'Workday', adapterSystem: 'workday', adapterProtocol: 'rest', name: 'HR Workday', status: 'error', config: {}, lastSync: null, syncFrequency: 'daily', recordsSynced: 0, connectedAt: '2026-02-01' },
          ],
        }),
      },
      assessments: { ...orig.api.assessments, list: vi.fn().mockResolvedValue({ assessments: [] }) },
    },
  };
});

import DataPage from '@/pages/DataPage';

describe('DataPage', () => {
  it('lists connected sources with sync freshness', async () => {
    render(<MemoryRouter><DataPage /></MemoryRouter>);
    expect(await screen.findByText('Production SAP')).toBeInTheDocument();
    expect(screen.getByText('HR Workday')).toBeInTheDocument();
    expect(screen.getByText(/SAP S\/4HANA/)).toBeInTheDocument();
  });

  it('shows an empty-state CTA when nothing is connected', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.erp.connections).mockResolvedValueOnce({ total: 0, connections: [] });
    render(<MemoryRouter><DataPage /></MemoryRouter>);
    expect(await screen.findByText(/connect your data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/DataPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/pages/DataPage.tsx`**

```tsx
/**
 * DataPage (/data) — canonical CONNECT stage. One question: is my data
 * flowing? Sources + freshness + the door to ingest. Read-only for
 * analysts; admin doors (Integrations) shown by role.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Database, ArrowRight } from 'lucide-react';
import { api, type ERPConnection, type Assessment } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { StatusPill, type StatusKind } from '@/components/ui/status-pill';
import { JourneyStageBar } from '@/components/journey/JourneyStageBar';

function syncKind(status: string): StatusKind {
  if (status === 'active' || status === 'connected') return 'completed';
  if (status === 'error' || status === 'failed') return 'failed';
  return 'pending';
}

export default function DataPage() {
  const role = useAppStore((s) => s.user?.role);
  const [connections, setConnections] = useState<ERPConnection[] | null>(null);
  const [latestAssessment, setLatestAssessment] = useState<Assessment | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [conns, assess] = await Promise.allSettled([api.erp.connections(), api.assessments.list()]);
      if (cancelled) return;
      setConnections(conns.status === 'fulfilled' ? conns.value.connections : []);
      if (assess.status === 'fulfilled') {
        const latest = [...assess.value.assessments]
          .filter((a) => a.status === 'complete')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        setLatestAssessment(latest ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isAdmin = role === 'superadmin' || role === 'support_admin' || role === 'admin';

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Journey · 01 Connect"
        title="Data"
        dek="Where your numbers come from — every finding traces back to a record synced here."
        actions={isAdmin ? (
          <Link to="/integrations" className="text-caption font-medium text-accent hover:underline inline-flex items-center gap-1">
            Manage integrations <ArrowRight size={11} aria-hidden="true" />
          </Link>
        ) : undefined}
      />
      <JourneyStageBar current="connect" />

      {connections === null ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 rounded animate-pulse" style={{ background: 'var(--border-card)' }} />)}
        </div>
      ) : connections.length === 0 ? (
        <Card className="p-8 text-center">
          <Database size={22} className="mx-auto t-muted" aria-hidden="true" />
          <p className="mt-3 t-primary font-medium">Connect your data</p>
          <p className="mt-1 text-caption t-muted">
            Atheon finds exposure in your ERP records. {isAdmin
              ? <Link to="/integrations" className="text-accent hover:underline">Connect an ERP or upload data</Link>
              : 'Ask your administrator to connect an ERP source.'}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label="Connected sources">
          {connections.map((c) => (
            <li key={c.id}>
              <Card className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="t-primary font-medium truncate">{c.name}</p>
                  <p className="text-caption t-muted truncate">{c.adapterName}</p>
                </div>
                <p className="text-caption t-muted tabular-nums">
                  {c.recordsSynced.toLocaleString()} records
                </p>
                <p className="text-caption t-muted">
                  {c.lastSync ? `synced ${formatDistanceToNow(new Date(c.lastSync), { addSuffix: true })}` : 'never synced'}
                </p>
                <StatusPill kind={syncKind(c.status)} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {latestAssessment && (
        <p className="mt-6 text-caption t-muted">
          Latest analysis: {latestAssessment.completedAt ? new Date(latestAssessment.completedAt).toLocaleDateString() : new Date(latestAssessment.createdAt).toLocaleDateString()} ·{' '}
          <Link to="/findings" className="text-accent hover:underline">see what it found</Link>
        </p>
      )}
    </div>
  );
}
```

Check `StatusPill`'s real prop API in `src/components/ui/status-pill.tsx` before use — if it needs a `label`/children, pass the raw `c.status`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/__tests__/DataPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the route**

In `src/App.tsx` — add with the other lazy imports:

```tsx
const DataPage = lazyWithRetry(() => import("@/pages/DataPage"));
```

and next to the `/dashboard` route (STANDARD_ROLES pattern — copy the exact `ProtectedRoute` usage from the `/pulse` route on ~line 194):

```tsx
<Route path="/data" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><DataPage /></ProtectedRoute>} />
```

- [ ] **Step 6: Typecheck, then commit**

Run: `npx tsc -b`
Expected: clean.

```bash
git add src/pages/DataPage.tsx src/pages/__tests__/DataPage.test.tsx src/App.tsx
git commit -m "feat(journey): DataPage — canonical Connect stage at /data"
```

---

### Task 4: FindingsPage — canonical Detect stage (`/findings`)

**Files:**
- Create: `src/pages/FindingsPage.tsx`
- Create: `src/pages/__tests__/FindingsPage.test.tsx`
- Modify: `src/components/dashboard/FindingsReviewTable.tsx` (add `limit` prop, fix dead `/value-assessment` link)
- Modify: `src/App.tsx` (add lazy route)

**Interfaces:**
- Consumes: `api.assessments.list()` / `api.assessments.get(id)` → `results.findings_summary: AssessmentFindingsSummary` (`total_count`, `total_value_at_risk_zar`, `potential_unverified_zar?`, `unverified_count?`); `FindingsReviewTable` (gets new prop `limit?: number` default 6); `JourneyStageBar`; `PageHeader`; `formatCompactCurrency`; `useTenantCurrency`.
- Produces: `export default function FindingsPage()`; `FindingsReviewTable` now accepts `{ limit?: number }`.

- [ ] **Step 1: Extend FindingsReviewTable (labels-only, backward compatible)**

In `src/components/dashboard/FindingsReviewTable.tsx`:
- Change signature to `export function FindingsReviewTable({ limit = 6 }: { limit?: number } = {})` and pass `limit` to `useLatestFindings(limit)`.
- Fix the dead link: `<Link to="/value-assessment"` → `<Link to="/findings"` (that route never existed in the router — verified 2026-07-03).
- Existing call sites (`ExecutiveSummaryPage`, prior Dashboard) pass no props — behavior unchanged.

- [ ] **Step 2: Write the failing page test**

`src/pages/__tests__/FindingsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/use-latest-findings', () => ({ useLatestFindings: () => [] }));
vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      assessments: {
        ...orig.api.assessments,
        list: vi.fn().mockResolvedValue({ assessments: [{ id: 'a1', status: 'complete', createdAt: '2026-07-01' }] }),
        get: vi.fn().mockResolvedValue({
          id: 'a1', status: 'complete',
          results: { findings_summary: {
            total_count: 12, total_value_at_risk_zar: 4200000,
            potential_unverified_zar: 999000, unverified_count: 3,
            by_severity: {}, by_category: {}, recommended_catalysts: [],
          } },
        }),
      },
    },
  };
});

import FindingsPage from '@/pages/FindingsPage';

describe('FindingsPage', () => {
  it('headline shows confidence-gated exposure only', async () => {
    render(<MemoryRouter><FindingsPage /></MemoryRouter>);
    const headline = await screen.findByTestId('exposure-headline');
    expect(headline.textContent).toMatch(/4[.,]2/); // R4.2M confirmed
    expect(headline.textContent).not.toMatch(/999/); // unverified never in headline
  });

  it('names the unverified remainder separately', async () => {
    render(<MemoryRouter><FindingsPage /></MemoryRouter>);
    expect(await screen.findByText(/below the confidence gate/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/FindingsPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/pages/FindingsPage.tsx`**

```tsx
/**
 * FindingsPage (/findings) — canonical DETECT stage. The headline is the
 * defensible number: Σ confidence-gated value-at-risk from the latest
 * complete assessment. Gate-failed value is named separately, never in the
 * headline (traceability rule). Table reuses FindingsReviewTable.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api, type AssessmentFindingsSummary } from '@/lib/api';
import { useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { JourneyStageBar } from '@/components/journey/JourneyStageBar';
import { FindingsReviewTable } from '@/components/dashboard/FindingsReviewTable';

export default function FindingsPage() {
  const currency = useTenantCurrency();
  const [summary, setSummary] = useState<AssessmentFindingsSummary | null | 'empty'>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { assessments } = await api.assessments.list();
        const latest = [...assessments]
          .filter((a) => a.status === 'complete')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        if (!latest) { if (!cancelled) setSummary('empty'); return; }
        const detail = await api.assessments.get(latest.id);
        if (!cancelled) setSummary(detail.results?.findings_summary ?? 'empty');
      } catch {
        if (!cancelled) setSummary('empty');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Journey · 02 Detect"
        title="Findings"
        dek="What Atheon found in your data — every amount drills to the ERP records behind it."
      />
      <JourneyStageBar current="detect" />

      <Card className="p-6 mb-8">
        {summary === null ? (
          <div className="h-10 w-48 rounded animate-pulse" aria-hidden="true" style={{ background: 'var(--border-card)' }} />
        ) : summary === 'empty' ? (
          <p className="t-muted">
            No completed analysis yet — <Link to="/data" className="text-accent hover:underline">connect your data</Link> to run one.
          </p>
        ) : (
          <>
            <p className="text-label t-muted uppercase">Detected exposure</p>
            <p data-testid="exposure-headline" className="mt-1 text-3xl font-bold t-primary tabular-nums">
              {formatCompactCurrency(summary.total_value_at_risk_zar, currency)}
            </p>
            <p className="mt-1 text-caption t-muted">
              across {summary.total_count} confidence-gated finding{summary.total_count === 1 ? '' : 's'}
              {summary.unverified_count && summary.unverified_count > 0
                ? ` · ${summary.unverified_count} more fell below the confidence gate and are excluded`
                : ''}
            </p>
            <Link to="/catalysts" className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline">
              Fix what was found <ArrowRight size={11} aria-hidden="true" />
            </Link>
          </>
        )}
      </Card>

      <FindingsReviewTable limit={50} />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/pages/__tests__/FindingsPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the route**

In `src/App.tsx`:

```tsx
const FindingsPage = lazyWithRetry(() => import("@/pages/FindingsPage"));
```

```tsx
<Route path="/findings" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><FindingsPage /></ProtectedRoute>} />
```

- [ ] **Step 7: Typecheck + full suite, then commit**

Run: `npx tsc -b && npx vitest run`
Expected: clean; FindingsReviewTable's existing consumers still pass.

```bash
git add src/pages/FindingsPage.tsx src/pages/__tests__/FindingsPage.test.tsx src/components/dashboard/FindingsReviewTable.tsx src/App.tsx
git commit -m "feat(journey): FindingsPage — canonical Detect stage at /findings"
```

---

### Task 5: Journey sidebar + stage bars on existing pages + copy renames

**Files:**
- Modify: `src/components/layout/Sidebar.tsx` (PRIMARY array ~lines 78-98, WORKSPACE children)
- Modify: `src/pages/CatalystsPage.tsx` (header copy + stage bar)
- Modify: `src/pages/ROIDashboardPage.tsx` (stage bar)
- Modify: `src/pages/ExecutiveSummaryPage.tsx` (stage bar)
- Test: `src/components/layout/__tests__/Sidebar.test.tsx` (create; if a Sidebar test already exists elsewhere, update it instead)

**Interfaces:**
- Consumes: `JourneyStageBar` (Task 1); existing `NavItem`/role-group constants in Sidebar.tsx; existing lucide imports (`Cable`, `ClipboardList` already imported).
- Produces: nav labels HOME · DATA · FINDINGS · FIXES · SAVINGS · REPORTS; Trust demoted to Workspace.

- [ ] **Step 1: Write the failing sidebar test**

`src/components/layout/__tests__/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAppStore } from '@/stores/appStore';

function renderAs(role: string) {
  useAppStore.setState({ user: { id: 'u1', name: 'T', email: 't@x.com', role } as never });
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
}

describe('Sidebar journey nav', () => {
  beforeEach(() => useAppStore.setState({ user: null as never }));

  it('analyst sees the plain-language journey rail (no Fixes/Savings/Reports)', () => {
    renderAs('analyst');
    for (const label of ['Home', 'Data', 'Findings', 'Settings']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Savings')).toBeNull();
    expect(screen.queryByText('Catalysts')).toBeNull(); // renamed
  });

  it('executive sees all six journey items labeled plainly', () => {
    renderAs('executive');
    for (const label of ['Home', 'Data', 'Findings', 'Savings', 'Reports']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('operator sees Fixes (not Catalysts)', () => {
    renderAs('operator');
    expect(screen.getAllByText('Fixes').length).toBeGreaterThan(0);
    expect(screen.queryByText('Catalysts')).toBeNull();
  });
});
```

Note: the Sidebar renders desktop + mobile bodies, hence `getAllByText`. Match the store's real `user` shape (read `src/stores/appStore.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/Sidebar.test.tsx`
Expected: FAIL — "Home"/"Data"/"Fixes" not found (current labels are Dashboard/Assurance/Catalysts).

- [ ] **Step 3: Rewrite PRIMARY + WORKSPACE in Sidebar.tsx**

Replace the `PRIMARY` array (keep icons already imported; `Cable` and `ClipboardList` are imported for admin rows — reuse):

```tsx
// The journey rail — the five-stage value loop in plain language, in loop
// order: CONNECT → DETECT → FIX → RECOVER → REPORT (spec 2026-07-03).
const PRIMARY: NavItem[] = [
  { path: '/dashboard',         label: 'Home',     icon: LayoutDashboard, roles: STANDARD_ROLES },
  { path: '/data',              label: 'Data',     icon: Cable,           roles: STANDARD_ROLES },
  { path: '/findings',          label: 'Findings', icon: ClipboardList,   roles: STANDARD_ROLES },
  { path: '/catalysts',         label: 'Fixes',    icon: ClipboardCheck,  roles: OPERATOR_ROLES },
  { path: '/roi-dashboard',     label: 'Savings',  icon: PiggyBank,       roles: EXECUTIVE_ROLES },
  { path: '/executive-summary', label: 'Reports',  icon: FileText,        roles: EXECUTIVE_ROLES },
];
```

Add Trust to `WORKSPACE.children` (demoted from the old primary rail; `ShieldCheck` already imported):

```tsx
{ path: '/trust', label: 'Trust', icon: ShieldCheck, roles: STANDARD_ROLES },
```

Update the file's header comment (lines 1-27) to describe the journey rail instead of the "curated executive rail". Remove now-unused icon imports if any (tsc will tell you).

- [ ] **Step 4: Run the sidebar test**

Run: `npx vitest run src/components/layout/__tests__/Sidebar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Stage bars + Catalysts header copy**

- `src/pages/CatalystsPage.tsx`: find its `PageHeader` (grep `PageHeader`). Set `title` to `"Fixes"` and `dek` to `"Catalyst runs — automated remediations, approvals, and the value ledger behind every recovered Rand."`. Insert `<JourneyStageBar current="fix" />` immediately after the PageHeader element, and add the import `import { JourneyStageBar } from '@/components/journey/JourneyStageBar';`. If the page composes its header differently (no PageHeader), place the bar as the first child of the page container and leave the internal title but add the dek line above it — smallest change that shows the loop.
- `src/pages/ROIDashboardPage.tsx`: same pattern, `<JourneyStageBar current="recover" />` after its header.
- `src/pages/ExecutiveSummaryPage.tsx`: same pattern, `<JourneyStageBar current="report" />` after its header.

- [ ] **Step 6: Full verification**

Run: `npx tsc -b && npx vitest run && npm run lint`
Expected: all clean. Also `grep -rn "value-assessment" src --include="*.tsx"` → only comments remain (no dead Links).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(journey): plain-language journey sidebar + stage bars + Fixes rename"
```

---

### Task 6: Full verification sweep

**Files:** none created — verification only.

- [ ] **Step 1: Full build + suite**

Run: `npm run build && npx vitest run`
Expected: production build succeeds, all tests pass.

- [ ] **Step 2: Stale-reference sweep**

Run:
```bash
grep -rn "KpiGrid\|IntelligencePanel\|ExecutiveOverview\|WorkingCapitalCard\|CloseCycleCard" src e2e --include="*.ts" --include="*.tsx"
grep -rn "from \"@/pages/Dashboard\"\|from '@/pages/Dashboard'" src e2e
```
Expected: no hits (fix any).

- [ ] **Step 3: e2e copy assertions**

Run: `grep -rn "Command Center\|Atheon Score\|Business Dimensions\|CATALYSTS\|Assurance" e2e src/test-setup.ts`
Any e2e assertion tied to deleted dashboard copy or the old nav labels must be updated to the journey copy (`Home`, `Fixes`, JourneyHome greeting).

- [ ] **Step 4: Drive the app**

Start `npm run dev`, log in with the dev seed, and screenshot: `/dashboard` (spine + needs-you-now), `/data`, `/findings`, sidebar. Confirm: 5 stage cards render with real or em-dash numbers; exactly one highlighted; nav shows the 6 plain labels; no console errors.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "test(journey): verification sweep fixes"
```
(skip if nothing changed)
