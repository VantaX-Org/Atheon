/**
 * The Brief — the executive landing (frontend-v2 spec §2/§3). One editorial
 * column that folds what used to be five separate summary screens into a single
 * honest read: the headline recovered figure, a handful of plain-language
 * deltas, the ≤3 decisions actually waiting on the reader, and a demoted
 * journey strip. It is NOT a dashboard — the closed primitive set (no grid, one
 * 65ch column) is what stops it degrading back into a wall of metric cards.
 *
 * Every number here traces to a real API field. Three independent honest
 * sources, fetched in parallel and degraded per-source (§3.8): a failed or
 * absent field renders an em-dash or an explicit "couldn't load" line — never a
 * coerced zero, never a false green. Atheon's fee is shown as its own line and
 * never netted against the recovered figure (money law).
 *
 * Mounted at /brief behind EXECUTIVE_ROLES; the classic JourneyHome stays at
 * /dashboard. The route existing IS the v2 opt-in (§10 step 1) — no flag system.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExecutiveSummaryResponse, FreshnessResponse } from '@/lib/api';
import { Money } from '@/components/common/Money';
import { useAppStore } from '@/stores/appStore';
import {
  BriefColumn, Dateline, Figure, Sentence, DecisionCard, ProgressRule, BriefHeading,
} from '@/components/brief/primitives';
import { ValueChainFlow } from '@/components/journey/ValueChainFlow';

type Approval = {
  id: string; clusterName: string; domain: string; catalystName: string;
  action: string; confidence: number; reasoning: string;
  inputData: Record<string, unknown>; createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Platform admin', support_admin: 'Support admin', admin: 'Admin',
  executive: 'Executive', manager: 'Manager',
};

/** Pull a monetary amount out of a catalyst's opaque inputData, honestly.
 *  Scans the keys a value-bearing catalyst actually uses; returns null (→ no
 *  amount shown) rather than inventing a figure when none is present. */
export function amountFrom(inputData: Record<string, unknown>): number | null {
  for (const k of ['amount', 'amountZar', 'value', 'totalValue', 'impact', 'exposure', 'recovered']) {
    const v = inputData?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function freshnessLine(f: FreshnessResponse | null): string {
  if (!f) return 'Freshness check unavailable.';
  if (f.globalStatus === 'fresh') return 'All connected sources are fresh.';
  if (f.globalStatus === 'stale') {
    const h = f.oldestAgeMinutes != null ? Math.round(f.oldestAgeMinutes / 60) : null;
    return h != null ? `Some sources are stale — oldest data is about ${h}h old.` : 'Some connected sources are stale.';
  }
  return 'Freshness could not be confirmed for every source.';
}

export function BriefPage() {
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exec, setExec] = useState<ExecutiveSummaryResponse | null>(null);
  const [fresh, setFresh] = useState<FreshnessResponse | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [execFailed, setExecFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.allSettled([
      api.executiveSummary.get(),
      api.freshness.get(),
      api.catalysts.pendingApprovals(),
    ]).then(([e, f, a]) => {
      if (!live) return;
      if (e.status === 'fulfilled') setExec(e.value); else setExecFailed(true);
      if (f.status === 'fulfilled') setFresh(f.value);
      if (a.status === 'fulfilled') setApprovals(a.value.approvals as Approval[]);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const company = user?.tenantName || 'Your organisation';
  const roleLabel = user ? ROLE_LABEL[user.role] ?? null : null;

  const recovered = exec?.roi.recovered ?? null;
  const fee = exec?.roi.cost ?? null;
  const improvement = exec?.journey.improvement ?? null;
  const baselineDate = exec?.journey.baselineDate;
  const topRisk = exec?.topRisks?.[0] ?? null;
  const decisions = (approvals ?? []).slice(0, 3);

  // First run: nothing recovered yet and no baseline captured — say so plainly,
  // point at onboarding, don't dress an empty tenant up as a result.
  const firstRun = exec != null && !recovered && exec.journey.baselineDate == null && (approvals?.length ?? 0) === 0;

  return (
    <BriefColumn>
      <Dateline
        dateLabel={dateLabel}
        company={company}
        freshness={freshnessLine(fresh)}
        viewingAs={roleLabel && <span className="text-xs t-muted">Viewing as {roleLabel}</span>}
      />

      <ValueChainFlow focus="report" />

      {firstRun ? (
        <section className="flex flex-col gap-3">
          <Figure label="Recovered to date" value={0} provenance={{ kind: 'confirmed' }} basis="Nothing recovered yet — your assessment hasn't produced confirmed recoveries." />
          <Sentence>
            Connect a source and run your first assessment to start the value loop.{' '}
            <button onClick={() => navigate('/onboarding')} className="text-accent font-medium hover:underline">Begin onboarding →</button>
          </Sentence>
        </section>
      ) : (
        <>
          <Figure
            label="Recovered to date"
            value={recovered}
            provenance={{ kind: 'confirmed', basis: 'Confirmed recoveries' }}
            basis={
              execFailed ? (
                "This figure couldn't be loaded. Nothing is being shown in its place."
              ) : (
                <>Confirmed recoveries. Atheon's fee is billed separately and never deducted from this figure.</>
              )
            }
          />

          {/* Deltas — plain-language, one line each. Money numerals go through
              <Money>; health-score points are not currency and stay as prose. */}
          {(improvement != null || (exec?.signals.newThisWeek ?? 0) > 0 || topRisk || fee != null) && (
            <section className="flex flex-col gap-3">
              <BriefHeading>Since your last read</BriefHeading>
              {improvement != null && (
                <Sentence>
                  Operational health has moved {improvement >= 0 ? 'up' : 'down'} {Math.abs(improvement)} point{Math.abs(improvement) === 1 ? '' : 's'}
                  {baselineDate ? ` since ${new Date(baselineDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}.
                </Sentence>
              )}
              {(exec?.signals.newThisWeek ?? 0) > 0 && (
                <Sentence>{exec!.signals.newThisWeek} new signal{exec!.signals.newThisWeek === 1 ? '' : 's'} surfaced this week.</Sentence>
              )}
              {topRisk && (
                <Sentence reversal>
                  Largest open exposure: {topRisk.title} —{' '}
                  <MoneyInline value={topRisk.impactValue} />. Modelled impact, not a confirmed loss.
                </Sentence>
              )}
              {fee != null && (
                <Sentence>
                  Atheon's fee for the period is <MoneyInline value={fee} confirmed />, billed separately.
                </Sentence>
              )}
            </section>
          )}

          {/* Decisions — the only cards. Real IDs, real reasoning text. */}
          {decisions.length > 0 && (
            <section className="flex flex-col gap-3">
              <BriefHeading>Waiting on you</BriefHeading>
              {decisions.map((d) => {
                const amt = amountFrom(d.inputData);
                return (
                  <DecisionCard
                    key={d.id}
                    title={d.catalystName || d.action}
                    amount={amt}
                    amountProvenance={amt != null ? { kind: 'unverified' } : undefined}
                    counterparty={[d.clusterName, d.domain].filter(Boolean).join(' · ')}
                    whatApproving={d.reasoning || d.action}
                    consequence={`Catalyst confidence ${Math.round(d.confidence * 100)}%. Awaiting your decision — no deadline set.`}
                    queuedBy={d.catalystName || 'Atheon catalyst'}
                    actionLabel="Review"
                    onAction={() => navigate('/decisions')}
                  />
                );
              })}
              {(approvals?.length ?? 0) > decisions.length && (
                <button onClick={() => navigate('/decisions')} className="text-sm text-accent font-medium hover:underline self-start">
                  {approvals!.length - decisions.length} more waiting — see all →
                </button>
              )}
            </section>
          )}
        </>
      )}

      <ProgressRule>
        <span>You're in the value loop.</span>
        <button onClick={() => navigate('/dashboard')} className="text-accent hover:underline">View the full journey →</button>
      </ProgressRule>
    </BriefColumn>
  );
}

/** Inline money for prose. Unverified (exposure/modelled) by default; pass
 *  `confirmed` for a real billed/recovered figure. */
function MoneyInline({ value, confirmed = false }: { value: number | null; confirmed?: boolean }) {
  return <Money value={value} provenance={{ kind: confirmed ? 'confirmed' : 'unverified' }} className="text-[15px]" />;
}

export default BriefPage;
