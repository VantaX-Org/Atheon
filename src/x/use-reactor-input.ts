// Single fetch for the reactor: operations categories (value-chain stages),
// decision gate, recovered, and the Atheon fee. Honesty law: any failed fetch
// leaves its field null (em-dash), never a fabricated zero.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { latestCompleteAssessment } from '@/lib/latest-assessment';
import type { ReactorInput } from './reactor-graph';

const CAT_LABEL: Record<string, string> = {
  finance: 'Finance', procurement: 'Procurement', supply_chain: 'Supply chain',
  sales: 'Sales', workforce: 'Workforce', compliance: 'Compliance',
  cross_cutting: 'Cross-cutting', service_delivery: 'Service delivery',
};

export const EMPTY_REACTOR_INPUT: ReactorInput = { ops: null, gate: null, recovered: null, fee: null, sourceCount: null, macro: null };

async function fetchReactorInput(): Promise<ReactorInput> {
  const [assessList, actions, roi, conns, radar] = await Promise.allSettled([
    api.assessments.list(),
    api.erp.actionsSummary(),
    api.roi.get(),
    api.erp.connections(),
    api.radar.signals(undefined, 10),
  ]);

  let ops: ReactorInput['ops'] = null;
  if (assessList.status === 'fulfilled') {
    const latest = latestCompleteAssessment(assessList.value.assessments);
    if (latest) {
      try {
        const detail = await api.assessments.get(latest.id);
        // findings_summary is computed server-side from the stored finding
        // rows when the persisted results lack it — no client-side re-fold
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
    recovered: roi.status === 'fulfilled' ? { zar: roi.value.totalDiscrepancyValueRecovered, mult: roi.value.roiMultiple ?? null } : null,
    fee: roi.status === 'fulfilled' && roi.value.platformCost != null ? { zar: roi.value.platformCost } : null,
    // "live" means live: connected sources, not the all-time attribution list
    sourceCount: conns.status === 'fulfilled'
      ? conns.value.connections.filter((c) => ['connected', 'active'].includes(c.status.toLowerCase())).length
      : null,
    // external factors head node — most relevant first, top 5 in the drawer
    macro: radar.status === 'fulfilled'
      ? {
          count: radar.value.total ?? radar.value.signals.length,
          signals: [...radar.value.signals]
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 5)
            .map((s) => ({ title: s.title, source: s.sourceName, sentiment: s.sentiment, relevance: s.relevanceScore })),
        }
      : null,
  };
}

export function useReactorInput(): { input: ReactorInput; loading: boolean } {
  const [input, setInput] = useState<ReactorInput>(EMPTY_REACTOR_INPUT);
  const [loading, setLoading] = useState(true);

  // all four sources are tenant-scoped (no company param) — fetch once on
  // mount; refetching on company switch just restarted the whole chain
  useEffect(() => {
    let cancelled = false;
    fetchReactorInput()
      .then((v) => { if (!cancelled) { setInput(v); setLoading(false); } })
      .catch(() => { if (!cancelled) { setInput(EMPTY_REACTOR_INPUT); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { input, loading };
}
