/**
 * FindingsPage (/findings) — canonical DETECT stage. The headline is the
 * defensible number: Σ confidence-gated value-at-risk from the latest
 * complete assessment. Gate-failed value is named separately, never in the
 * headline (traceability rule). Triage reuses AssessmentFindingsPanel so
 * the headline and the finding list come from the SAME assessment payload
 * (severity/category/entity filters, sample-record traceback, per-finding
 * Deploy → Fixes).
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api, type AssessmentResults } from '@/lib/api';
import { useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { AssessmentFindingsPanel } from '@/components/AssessmentFindingsPanel';
import { catalystDeployUrl } from '@/lib/catalyst-recommendation';
import { latestCompleteAssessment } from '@/lib/latest-assessment';

export default function FindingsPage() {
  const currency = useTenantCurrency();
  const navigate = useNavigate();
  const [results, setResults] = useState<AssessmentResults | null | 'empty' | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { assessments } = await api.assessments.list();
        const latest = latestCompleteAssessment(assessments);
        if (!latest) { if (!cancelled) setResults('empty'); return; }
        const detail = await api.assessments.get(latest.id);
        if (cancelled) return;
        setResults(detail.results?.findings_summary ? detail.results : 'empty');
      } catch {
        if (!cancelled) setResults('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const summary = results && typeof results === 'object' ? results.findings_summary : undefined;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Journey · 02 Detect"
        title="Findings"
        dek="What Atheon found in your data — every amount drills to the ERP records behind it."
      />

      <Card className="p-6 mb-8">
        {results === null ? (
          <div className="h-10 w-48 rounded animate-pulse" aria-hidden="true" style={{ background: 'var(--border-card)' }} />
        ) : results === 'error' ? (
          <p className="t-muted">
            Couldn't load findings. Refresh to try again — this is a loading problem, not your data.
          </p>
        ) : results === 'empty' ? (
          <p className="t-muted">
            No completed analysis yet — <Link to="/operations" className="text-accent hover:underline">connect your data</Link> to run one.
          </p>
        ) : summary ? (
          <>
            <p className="text-label t-muted uppercase">Detected exposure</p>
            <p data-testid="exposure-headline" className="mt-1 text-3xl font-bold t-primary tabular-nums">
              {formatCompactCurrency(summary.total_value_at_risk_zar, currency)}
            </p>
            <p className="mt-1 text-caption t-muted">
              across {summary.total_count} verified finding{summary.total_count === 1 ? '' : 's'}
              {summary.unverified_count && summary.unverified_count > 0
                ? ` · ${summary.potential_unverified_zar != null ? `${formatCompactCurrency(summary.potential_unverified_zar, currency)} in ` : ''}${summary.unverified_count} more need review before we count them`
                : ''}
            </p>
            <Link to="/catalysts" className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline">
              Fix what was found <ArrowRight size={11} aria-hidden="true" />
            </Link>
          </>
        ) : null}
      </Card>

      {results !== null && typeof results === 'object' && (
        <AssessmentFindingsPanel
          findings={results.findings ?? []}
          summary={summary}
          findingsByCompany={results.findings_by_company}
          companyProfile={results.company_profile}
          onDeployCatalyst={(catalyst, subCatalyst) =>
            navigate(catalystDeployUrl({ catalyst, subCatalyst }))
          }
        />
      )}
    </div>
  );
}
