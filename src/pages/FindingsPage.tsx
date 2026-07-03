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
