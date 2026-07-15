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
  report: '/brief',
};

/**
 * Roles allowed through each stage route's gate (mirror of App.tsx route guards —
 * keep in sync). null = STANDARD, any role that can see a journey page at all.
 */
const STAGE_ROLES: Record<StageKey, string[] | null> = {
  connect: null,
  detect: null,
  fix: ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'], // OPERATOR_ROLES
  recover: ['superadmin', 'support_admin', 'admin', 'executive'], // EXECUTIVE_ROLES
  report: ['superadmin', 'support_admin', 'admin', 'executive'], // EXECUTIVE_ROLES
};

/** Can this role click through to the stage's page without hitting a 403? */
export function stageAccessible(key: StageKey, role: string | undefined): boolean {
  const allowed = STAGE_ROLES[key];
  return !allowed || (!!role && allowed.includes(role));
}

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
  // Open exposure, empty approval queue, nothing recovered yet: the work is
  // deploying fixes — pointing at RECOVER (zero savings) is a dead end.
  if (i.exposure.openValueZar > 0 && (!i.savings || i.savings.recoveredZar === 0)) return 'fix';
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
      // "Review findings" promises work that isn't there when nothing is open.
      cta: exposure && exposure.findingCount > 0 ? 'Review findings' : 'View findings',
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
