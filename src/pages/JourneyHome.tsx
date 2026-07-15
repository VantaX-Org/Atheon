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
import { latestCompleteAssessment } from '@/lib/latest-assessment';
import { JourneySpine } from '@/components/journey/JourneySpine';
import { PersonaRail, defaultPersona, PERSONA_LABELS } from '@/components/journey/PersonaRail';
import type { Persona } from '@/types';
import { useToast } from '@/components/ui/toast';
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
  const setUser = useAppStore((s) => s.setUser);
  const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const toast = useToast();
  const [input, setInput] = useState<StageInput | null>(null);

  // Board lens (spec 2026-07-15): the C-suite viewer picks which lens the board
  // shows and the PersonaRail follows it live. Starts on the saved default (or
  // role default for reachability); nothing persists until "Set as default".
  const [lens, setLens] = useState<Persona | null>(null);
  const [savingLens, setSavingLens] = useState(false);
  useEffect(() => { setLens((cur) => cur ?? defaultPersona(user)); }, [user]);

  const setLensDefault = async () => {
    if (!user || !lens) return;
    setSavingLens(true);
    try {
      await api.auth.setPersona(lens);
      setUser({ ...user, persona: lens });
    } catch {
      toast.error('Failed to save your default view');
    }
    setSavingLens(false);
  };

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
      // Honesty law: exposure stays null (em-dash, no claim) until a complete
      // assessment with a findings_summary exists — "R0" before detection has
      // run would read as a false all-clear.
      let exposure: StageInput['exposure'] = null;
      if (assessList.status === 'fulfilled') {
        const latest = latestCompleteAssessment(assessList.value.assessments);
        if (latest) {
          try {
            const detail = await api.assessments.get(latest.id);
            const s = detail.results?.findings_summary;
            if (s) exposure = { openValueZar: s.total_value_at_risk_zar, findingCount: s.total_count };
          } catch { /* exposure stays null */ }
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

  // One plain sentence locating the user in the loop. Each clause is gated on
  // its fetch succeeding — a failed fetch makes no claim, not a zero claim.
  const parts: string[] = [];
  if (input?.connections && input.connections.total > 0) {
    parts.push(`${input.connections.total} source${input.connections.total === 1 ? '' : 's'} connected`);
    if (input.connections.broken > 0) parts.push(`${input.connections.broken} need${input.connections.broken === 1 ? 's' : ''} attention`);
  }
  if (input?.exposure) parts.push(`${formatCompactCurrency(input.exposure.openValueZar, currency)} open exposure`);
  if (input?.savings) parts.push(`${formatCompactCurrency(input.savings.recoveredZar, currency)} recovered to date`);
  const locator = parts.join(' · ');
  // No dek while loading or when every fetch failed; the first-run line only
  // when we KNOW there are zero connections (not when the fetch failed).
  const dek = !input
    ? undefined
    : locator || (input.connections?.total === 0 ? 'Connect your data to start the loop.' : undefined);

  const pending = input?.fixes && input.fixes.pendingCount > 0 ? input.fixes : null;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Atheon · Your journey"
        title={getGreeting(user?.name?.split(' ')[0])}
        dek={dek}
        actions={lens ? (
          <div className="flex items-center gap-2">
            <label htmlFor="board-lens" className="text-label t-muted uppercase hidden sm:inline">Viewing as</label>
            <select
              id="board-lens"
              aria-label="Board lens"
              value={lens}
              onChange={(e) => setLens(e.target.value as Persona)}
              className="px-2 py-1 rounded-md border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
            >
              {(Object.keys(PERSONA_LABELS) as Persona[]).map((p) => (
                <option key={p} value={p}>{PERSONA_LABELS[p]}</option>
              ))}
            </select>
            {lens !== (user?.persona ?? null) && (
              <button
                type="button"
                disabled={savingLens}
                onClick={() => { void setLensDefault(); }}
                className="text-caption font-medium text-accent hover:underline disabled:opacity-50"
              >
                Set as default
              </button>
            )}
          </div>
        ) : undefined}
      />

      {/* Security banner — preserved verbatim from the retired Dashboard:
          mfaEnforcementWarning is a MfaEnforcementWarning object (daysRemaining
          / reason / mfaSetupUrl), not a string. Escalates to critical (neg)
          styling once the grace period expires. */}
      {mfaEnforcementWarning && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3 rounded-md mb-6"
          style={{
            background: mfaEnforcementWarning.daysRemaining <= 0 ? 'rgb(var(--neg-rgb) / 0.08)' : 'rgba(154, 107, 31, 0.08)',
            border: mfaEnforcementWarning.daysRemaining <= 0 ? '1px solid rgb(var(--neg-rgb) / 0.30)' : '1px solid rgba(154, 107, 31, 0.30)',
          }}
        >
          <AlertTriangle
            size={16}
            className="flex-shrink-0 mt-0.5"
            style={{ color: mfaEnforcementWarning.daysRemaining <= 0 ? 'var(--neg)' : 'var(--warning)' }}
          />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: mfaEnforcementWarning.daysRemaining <= 0 ? 'var(--neg)' : 'var(--warning)' }}>
              {mfaEnforcementWarning.daysRemaining <= 0
                ? 'MFA is now required for your role'
                : `MFA required for your role — enable within ${mfaEnforcementWarning.daysRemaining} day${mfaEnforcementWarning.daysRemaining === 1 ? '' : 's'} to keep access.`}
            </p>
            {mfaEnforcementWarning.reason && (
              <p className="text-xs t-muted mt-0.5">{mfaEnforcementWarning.reason}</p>
            )}
          </div>
          <Link
            to={mfaEnforcementWarning.mfaSetupUrl || '/settings/mfa'}
            className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            Enable MFA now
          </Link>
        </div>
      )}

      {/* First-run: a brand-new tenant has no data yet — give it one obvious
          door into the guided setup instead of leaving it to hunt the nav. */}
      {input?.connections?.total === 0 && (
        <Link to="/onboarding" className="block group mb-6">
          <Card className="p-4 flex items-center justify-between gap-4" style={{ background: 'var(--accent-subtle)' }}>
            <div>
              <p className="t-primary font-medium">New here? Let's get your first numbers.</p>
              <p className="text-caption t-muted">Connect your data and Atheon walks you through the whole loop.</p>
            </div>
            <span className="text-caption font-medium text-accent inline-flex items-center gap-1 shrink-0">
              Get started <ArrowRight size={12} aria-hidden="true" />
            </span>
          </Card>
        </Link>
      )}

      <JourneySpine stages={stages} />

      {/* "What needs me now" outranks contextual insights — approvals are
          money stopped in the loop, so they sit directly under the spine. */}
      <section aria-label="Needs you now" className="mt-6">
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

      <PersonaRail user={user} fixedPersona={lens ?? undefined} />
    </div>
  );
}
