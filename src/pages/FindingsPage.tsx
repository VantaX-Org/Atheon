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
import { api, type AssessmentResults, type AssessmentFinding, type ValueAssessmentFinding } from '@/lib/api';
import { useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { PageHeader } from '@/components/ui/page-header';
import { ValueChainFlow } from '@/components/journey/ValueChainFlow';
import { Card } from '@/components/ui/card';
import { AssessmentFindingsPanel } from '@/components/AssessmentFindingsPanel';
import { catalystDeployUrl, recommendForRisk, recommendForAnomaly } from '@/lib/catalyst-recommendation';
import { latestCompleteAssessment } from '@/lib/latest-assessment';

/**
 * The GTM engine writes findings inline on results.findings; the value engine
 * persists them in the findings table (GET /assessments/:id/findings) and the
 * detail payload carries only findings_summary. Map the value-engine shape into
 * the panel's contract so both engines triage through the same UI. Confidence
 * is left unset — the gauge honestly renders "Indicative — confirm".
 */
function toAssessmentFinding(f: ValueAssessmentFinding): AssessmentFinding {
  const samples = f.evidence?.sample_records ?? [];
  const rec = recommendForRisk({ category: f.category, title: f.title })
    ?? recommendForAnomaly(`${f.category} ${f.title} ${f.domain}`);
  const narrative = [f.finding_insight || f.description, f.prescription ? `Fix: ${f.prescription}` : '']
    .filter(Boolean).join(' ');
  return {
    id: f.id,
    code: f.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase(),
    category: f.category as AssessmentFinding['category'],
    severity: f.severity,
    title: f.title,
    narrative,
    affected_count: f.affected_records,
    value_at_risk_zar: f.financial_impact,
    value_components: [
      ...(f.immediate_value > 0 ? [{ label: 'Immediate recoverable value', amount_zar: f.immediate_value, methodology: 'One-off recovery evidenced by the sampled records' }] : []),
      ...(f.ongoing_monthly_value > 0 ? [{ label: 'Ongoing monthly value', amount_zar: f.ongoing_monthly_value, methodology: 'Recurring monthly impact once the root cause is fixed' }] : []),
    ],
    currency_breakdown: {},
    sample_records: samples.map((s) => ({
      ref: s.ref,
      description: `${s.source_value} vs ${s.target_value}`,
      amount_zar: typeof s.difference === 'number' ? s.difference : undefined,
    })),
    recommended_catalyst: rec
      ? { catalyst: rec.catalyst, sub_catalyst: rec.subCatalyst }
      : { catalyst: 'General Operations Excellence Catalyst', sub_catalyst: 'Quality Assurance' },
    metric_signature: f.finding_type,
    evidence_quality: samples.length > 0 ? 'high' : 'medium',
    erp_record_id: samples[0]?.ref,
    detected_at: f.created_at,
  };
}

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
        let res = detail.results;
        if (res?.findings_summary && !res.findings?.length) {
          try {
            const { findings } = await api.assessments.findings(latest.id);
            if (findings?.length) res = { ...res, findings: findings.map(toAssessmentFinding) };
          } catch { /* summary-only render still stands */ }
        }
        if (cancelled) return;
        setResults(res?.findings_summary ? res : 'empty');
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

      <ValueChainFlow focus="detect" />

      <Card className="p-6 mb-8">
        {results === null ? (
          <div className="h-10 w-48 rounded animate-pulse" aria-hidden="true" style={{ background: 'var(--border-card)' }} />
        ) : results === 'error' ? (
          <p className="t-muted">
            Couldn't load findings. Refresh to try again — this is a loading problem, not your data.
          </p>
        ) : results === 'empty' ? (
          <p className="t-muted">
            No completed analysis yet — <Link to="/x/ops" className="text-accent hover:underline">connect your data</Link> to run one.
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
            <Link to="/x/fixes" className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline">
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
