// Single fetch for the reactor: operations categories (value-chain stages),
// decision gate, recovered, and the Atheon fee. Honesty law: any failed fetch
// leaves its field null (em-dash), never a fabricated zero.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSelectedCompanyId } from '@/stores/appStore';
import { latestCompleteAssessment } from '@/lib/latest-assessment';
import type { ReactorInput } from './reactor-graph';

const CAT_LABEL: Record<string, string> = {
  finance: 'Finance', procurement: 'Procurement', supply_chain: 'Supply chain',
  sales: 'Sales', workforce: 'Workforce', compliance: 'Compliance',
  cross_cutting: 'Cross-cutting', service_delivery: 'Service delivery',
};

export const EMPTY_REACTOR_INPUT: ReactorInput = { ops: null, gate: null, recovered: null, fee: null };

async function fetchReactorInput(): Promise<ReactorInput> {
  const [assessList, actions, roi] = await Promise.allSettled([
    api.assessments.list(),
    api.erp.actionsSummary(),
    api.roi.get(),
  ]);

  let ops: ReactorInput['ops'] = null;
  if (assessList.status === 'fulfilled') {
    const latest = latestCompleteAssessment(assessList.value.assessments);
    if (latest) {
      try {
        const detail = await api.assessments.get(latest.id);
        const s = detail.results?.findings_summary;
        if (s) {
          ops = {
            categories: Object.entries(s.by_category ?? {}).map(([key, v]) => ({
              key, label: CAT_LABEL[key] ?? key, count: v.count, valueZar: v.value_at_risk_zar,
            })),
            totalZar: s.total_value_at_risk_zar,
            totalCount: s.total_count,
          };
        }
      } catch { /* ops stays null */ }
    }
  }

  return {
    ops,
    gate: actions.status === 'fulfilled'
      ? {
          pendingCount: actions.value.summary.pending_approval_count,
          pendingZar: actions.value.summary.pending_approval_value_zar,
          reviewCount: actions.value.summary.previewed_count,
          reviewZar: actions.value.summary.previewed_value_zar,
          reversedCount: actions.value.summary.failed_count + actions.value.summary.rejected_count,
          reversedZar: actions.value.summary.failed_value_zar + actions.value.summary.rejected_value_zar,
        }
      : null,
    recovered: roi.status === 'fulfilled' ? { zar: roi.value.totalDiscrepancyValueRecovered } : null,
    fee: roi.status === 'fulfilled' && roi.value.platformCost != null ? { zar: roi.value.platformCost } : null,
  };
}

export function useReactorInput(): { input: ReactorInput; loading: boolean } {
  const companyId = useSelectedCompanyId();
  const [input, setInput] = useState<ReactorInput>(EMPTY_REACTOR_INPUT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchReactorInput()
      .then((v) => { if (!cancelled) { setInput(v); setLoading(false); } })
      .catch(() => { if (!cancelled) { setInput(EMPTY_REACTOR_INPUT); setLoading(false); } });
    return () => { cancelled = true; };
  }, [companyId]);

  return { input, loading };
}
