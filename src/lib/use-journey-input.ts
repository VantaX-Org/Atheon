/**
 * useJourneyInput — the single source for the five-stage loop numbers
 * (Data → Findings → Fixes → Savings → Reports). Extracted from JourneyHome so
 * the ValueChainFlow graphic can ride on every stage page without each one
 * re-implementing the four-endpoint fetch.
 *
 * Honesty law is preserved verbatim from JourneyHome: every field is null when
 * its fetch fails (em-dash, no claim); exposure stays null until a *complete*
 * assessment with a findings_summary exists — "R0" before detection would read
 * as a false all-clear.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { buildJourneyStages, type JourneyStage, type StageInput } from '@/lib/journey';
import { latestCompleteAssessment } from '@/lib/latest-assessment';

async function fetchJourneyInput(): Promise<StageInput> {
  const [conns, assessList, actions, roi] = await Promise.allSettled([
    api.erp.connections(),
    api.assessments.list(),
    api.erp.actionsSummary(),
    api.roi.get(),
  ]);

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

  return {
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
  };
}

// ponytail: fetches per mount — no cache. These are cheap summary endpoints and
// the graphic remounts on navigation, not in a tight loop. Add a short-TTL cache
// keyed by companyId only if a profiler shows the repeat load actually hurts.
export function useJourneyInput(): { input: StageInput | null; stages: JourneyStage[]; loading: boolean } {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [input, setInput] = useState<StageInput | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJourneyInput()
      .then((v) => { if (!cancelled) { setInput(v); setLoading(false); } })
      .catch(() => { if (!cancelled) { setInput(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [companyId]);

  const stages = buildJourneyStages(
    input ?? { connections: null, exposure: null, fixes: null, savings: null },
    currency,
  );
  return { input, stages, loading };
}
