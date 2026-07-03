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
        const assessments = assessList.value.assessments;
        if (assessments.length === 0) {
          // No assessments at all: truly zero exposure.
          exposure = { openValueZar: 0, findingCount: 0 };
        } else {
          const latest = latestCompleteAssessment(assessments);
          if (!latest) {
            // Assessments exist but none complete: exposure is unknown (e.g. still running).
            exposure = null;
          } else {
            try {
              const detail = await api.assessments.get(latest.id);
              const s = detail.results?.findings_summary;
              exposure = s ? { openValueZar: s.total_value_at_risk_zar, findingCount: s.total_count } : { openValueZar: 0, findingCount: 0 };
            } catch { exposure = null; }
          }
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
