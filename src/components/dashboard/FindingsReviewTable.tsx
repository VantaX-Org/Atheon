/**
 * FindingsReviewTable — the billing proof on the executive dashboard,
 * wired from the Higgsfield render's "FINDINGS & FIELD MAPPING REVIEW"
 * table (docs/ui-redesign/higgsfield/01-dashboard.png).
 *
 * Each row is ONE real finding from the latest completed value
 * assessment, with the chain that makes its dollar auditable:
 *
 *   FINDING            ERP RECORD     FIELD MAPPING    ASSURANCE   AMOUNT
 *   GR/IR mismatch     PO-4471        Procurement      High        R1.2M
 *
 * Honesty note: `ValueAssessmentFinding` carries no numeric confidence
 * score (that lives on the separate GTM `AssessmentFinding` contract), so
 * we do NOT fabricate a confidence percentage. The ASSURANCE column shows
 * the finding's own `severity` band — a real field — never an invented %.
 * This keeps with the inference-strength rule: no silently-applied weak
 * signal dressed up as certainty.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ValueAssessmentFinding } from '@/lib/api';
import { useLatestFindings } from '@/lib/use-latest-findings';
import { formatCurrency } from '@/lib/format-currency';

type Severity = ValueAssessmentFinding['severity'];

/** Severity → assurance chip. Real field, honest label, ledger palette. */
const SEVERITY_CHIP: Record<Severity, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical',  color: 'var(--neg)',     bg: 'color-mix(in srgb, var(--neg) 10%, transparent)' },
  high:     { label: 'High',      color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 12%, transparent)' },
  medium:   { label: 'Medium',    color: 'var(--accent)',  bg: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
  low:      { label: 'Low',       color: 'var(--text-muted)', bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)' },
};

const TITLE = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function FindingsReviewTable({ limit = 6 }: { limit?: number } = {}) {
  const findings = useLatestFindings(limit);
  const currency = 'ZAR';

  return (
    <section aria-label="Findings and field mapping review" className="pt-7" style={{ borderTop: '1px solid var(--border-card)' }}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-label" style={{ color: 'var(--text-muted)' }}>FINDINGS &amp; FIELD MAPPING REVIEW</p>
        <Link to="/findings" className="text-caption text-accent hover:underline inline-flex items-center gap-1 font-medium">
          All findings <ArrowRight size={11} />
        </Link>
      </div>

      {findings === null ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 rounded animate-pulse" style={{ background: 'var(--border-card)' }} />
          ))}
        </div>
      ) : findings.length === 0 ? (
        <p className="text-caption t-muted py-6">
          No findings yet — <Link to="/catalysts" className="text-accent hover:underline">run a catalyst</Link> to populate the billing ledger.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="text-label" style={{ color: 'var(--text-muted)' }}>
                <Th>Finding</Th>
                <Th>ERP Record</Th>
                <Th>Field Mapping</Th>
                <Th>Assurance</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => {
                const ref = f.evidence?.sample_records?.[0]?.ref;
                const chip = SEVERITY_CHIP[f.severity];
                return (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--divider)' }}>
                    <td className="py-3 pr-4 align-top">
                      <p className="text-body-sm t-primary font-medium truncate max-w-[22rem]">{f.title}</p>
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <span className="text-caption font-mono t-secondary">
                        {ref ?? `${f.affected_records.toLocaleString('en-ZA')} records`}
                      </span>
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <span className="text-caption t-secondary">{TITLE(f.domain)}</span>
                      {f.category && <span className="text-caption t-muted"> · {f.category}</span>}
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase"
                        style={{ color: chip.color, background: chip.bg }}
                      >
                        {chip.label}
                      </span>
                    </td>
                    <td className="py-3 align-top text-right">
                      <span className="text-body-sm font-mono font-semibold tnum t-primary">
                        {formatCurrency(f.financial_impact, currency)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`pb-2 pr-4 font-medium ${className}`}>{children}</th>;
}

export default FindingsReviewTable;
