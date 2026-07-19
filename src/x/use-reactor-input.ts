// Single fetch for the reactor: operations categories (value-chain stages),
// decision gate, and recovered. Honesty law: any failed fetch leaves its
// field null (em-dash), never a fabricated zero.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { latestCompleteAssessment } from '@/lib/latest-assessment';
import type { ReactorInput } from './reactor-graph';

const CAT_LABEL: Record<string, string> = {
  finance: 'Finance', procurement: 'Procurement', supply_chain: 'Supply chain',
  sales: 'Sales', workforce: 'Workforce', compliance: 'Compliance',
  cross_cutting: 'Cross-cutting', service_delivery: 'Service delivery',
};

export const EMPTY_REACTOR_INPUT: ReactorInput = { ops: null, gate: null, recovered: null, sourceCount: null, macro: null, health: null, pulse: null };

async function fetchReactorInput(): Promise<ReactorInput> {
  const [assessList, actions, pending, roi, conns, radar, health, briefing] = await Promise.allSettled([
    api.assessments.list(),
    api.erp.actionsSummary(),
    api.erp.listAllActions({ status: 'pending_approval', limit: 6 }),
    api.roi.get(),
    api.erp.connections(),
    api.radar.signals(undefined, 10),
    api.apex.health(),
    api.apex.briefing(),
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
          rejectedCount: actions.value.summary.rejected_count,
          rejectedZar: actions.value.summary.rejected_value_zar,
          failedCount: actions.value.summary.failed_count,
          failedZar: actions.value.summary.failed_value_zar,
          // receipt lines for the gate drawer — the decisions behind the number
          pending: pending.status === 'fulfilled'
            ? pending.value.actions.map((a) => ({ label: a.catalyst_name, type: a.action_type, valueZar: a.value_zar }))
            : undefined,
        }
      : null,
    recovered: roi.status === 'fulfilled'
      ? {
          zar: roi.value.totalDiscrepancyValueRecovered,
          mult: roi.value.roiMultiple ?? null,
          // per-source attribution of the recovered figure (v60 breakdown)
          bySource: roi.value.breakdown?.byConnection?.length
            ? roi.value.breakdown.byConnection.map((c) => ({ label: c.label, zar: c.recoveredValue, share: c.share, records: c.inputRecords }))
            : undefined,
        }
      : null,
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
            .map((s) => ({ id: s.id, title: s.title, source: s.sourceName, sentiment: s.sentiment, relevance: s.relevanceScore })),
        }
      : null,
    // live health dimensions — trend chips on the value-chain tiles
    health: health.status === 'fulfilled'
      ? {
          overall: health.value.overall,
          dims: Object.fromEntries(Object.entries(health.value.dimensions).map(
            ([k, d]) => [k, { score: d.score, trend: d.trend, delta: d.delta ?? null }],
          )),
        }
      : null,
    // since-last-period pulse — the hero delta strip; null fields simply don't render
    pulse: briefing.status === 'fulfilled'
      ? {
          healthDelta: briefing.value.healthDelta,
          redMetricCount: briefing.value.redMetricCount,
          anomalyCount: briefing.value.anomalyCount,
          activeRiskCount: briefing.value.activeRiskCount,
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
