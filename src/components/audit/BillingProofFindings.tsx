/**
 * BillingProofFindings — the "AUDIT TRAIL / FINDINGS DETAIL · BILLING-PROOF
 * VIEW" from the Higgsfield render (docs/ui-redesign/higgsfield/03-audit.png),
 * wired to real value-assessment findings.
 *
 * Each row exposes the full audit chain behind a billed dollar:
 *
 *   FINDING · ERP RECORD · FIELD MAPPING · SOURCE → TARGET · DIFFERENCE
 *   · ASSURANCE · FINANCIAL IMPACT          [click → provenance]
 *
 * Source/target/difference come from `evidence.sample_records[0]` — the
 * literal ERP cells that disagreed. Expanding a row reveals its provenance:
 * statistical basis (pattern / frequency / first occurrence) and root cause.
 *
 * Honesty: no fabricated confidence %. The ASSURANCE column shows the
 * finding's real `severity` band, consistent with the dashboard table.
 */
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { ValueAssessmentFinding } from '@/lib/api';
import { latestCompleteAssessment } from '@/lib/latest-assessment';
import { formatCurrency } from '@/lib/format-currency';

type Severity = ValueAssessmentFinding['severity'];

const SEVERITY_CHIP: Record<Severity, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'var(--neg)',        bg: 'color-mix(in srgb, var(--neg) 10%, transparent)' },
  high:     { label: 'High',     color: 'var(--warning)',    bg: 'color-mix(in srgb, var(--warning) 12%, transparent)' },
  medium:   { label: 'Medium',   color: 'var(--accent)',     bg: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
  low:      { label: 'Low',      color: 'var(--text-muted)', bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)' },
};

const TITLE = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cell = (v: string | number | undefined) => (v === undefined || v === '' ? '—' : String(v));

export function BillingProofFindings() {
  // Inline fetch instead of the shared useLatestFindings hook: that hook
  // collapses every failure to [] (fine for the dashboard, dishonest here —
  // "No billing-proof findings yet" from a 403/failed fetch is a false claim
  // on an audit surface). The assessments list API is superadmin-only, so
  // admins and auditors always 403; they must see "not available", not "none".
  const [findings, setFindings] = useState<ValueAssessmentFinding[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const currency = 'ZAR';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { assessments } = await api.assessments.list();
        const latest = latestCompleteAssessment(assessments);
        if (!latest) { if (!cancelled) setFindings([]); return; }
        const { findings } = await api.assessments.findings(latest.id);
        if (cancelled) return;
        setFindings([...findings].sort((a, b) => b.financial_impact - a.financial_impact).slice(0, 12));
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <p className="text-caption t-muted py-6">
        {forbidden
          ? 'Billing-proof findings are not available for your role.'
          : 'Billing-proof findings could not be loaded — the assessment service did not respond.'}
      </p>
    );
  }
  if (findings === null) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 rounded animate-pulse" style={{ background: 'var(--border-card)' }} />
        ))}
      </div>
    );
  }
  if (findings.length === 0) {
    return <p className="text-caption t-muted py-6">No billing-proof findings yet — run a value assessment to populate the audit trail.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="text-label" style={{ color: 'var(--text-muted)' }}>
            <th className="pb-2 pr-4 font-medium" />
            <th className="pb-2 pr-4 font-medium">Finding</th>
            <th className="pb-2 pr-4 font-medium">ERP Record</th>
            <th className="pb-2 pr-4 font-medium">Field Mapping</th>
            <th className="pb-2 pr-4 font-medium text-right">Source</th>
            <th className="pb-2 pr-4 font-medium text-right">Target</th>
            <th className="pb-2 pr-4 font-medium text-right">Difference</th>
            <th className="pb-2 pr-4 font-medium">Assurance</th>
            <th className="pb-2 font-medium text-right">Financial Impact</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => {
            const sample = f.evidence?.sample_records?.[0];
            const chip = SEVERITY_CHIP[f.severity];
            const isOpen = open === f.id;
            return (
              <FindingRows
                key={f.id}
                finding={f}
                sample={sample}
                chip={chip}
                isOpen={isOpen}
                currency={currency}
                onToggle={() => setOpen(isOpen ? null : f.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FindingRows({
  finding: f,
  sample,
  chip,
  isOpen,
  currency,
  onToggle,
}: {
  finding: ValueAssessmentFinding;
  sample: { ref: string; source_value: string | number; target_value: string | number; difference: number } | undefined;
  chip: { label: string; color: string; bg: string };
  isOpen: boolean;
  currency: string;
  onToggle: () => void;
}) {
  const ev = f.evidence ?? {};
  const hasProvenance = !!(ev.pattern || ev.frequency || ev.first_occurrence || f.root_cause);
  return (
    <>
      <tr
        style={{ borderTop: '1px solid var(--divider)', cursor: hasProvenance ? 'pointer' : 'default' }}
        onClick={hasProvenance ? onToggle : undefined}
      >
        <td className="py-3 pr-2 align-top">
          {hasProvenance && (
            <ChevronRight
              size={13}
              className="transition-transform"
              style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
              aria-hidden="true"
            />
          )}
        </td>
        <td className="py-3 pr-4 align-top">
          <p className="text-body-sm t-primary font-medium truncate max-w-[16rem]">{f.title}</p>
        </td>
        <td className="py-3 pr-4 align-top">
          <span className="text-caption font-mono t-secondary">{sample?.ref ?? `${f.affected_records.toLocaleString('en-ZA')} recs`}</span>
        </td>
        <td className="py-3 pr-4 align-top">
          <span className="text-caption t-secondary">{TITLE(f.domain)}</span>
          {f.category && <span className="text-caption t-muted"> · {f.category}</span>}
        </td>
        <td className="py-3 pr-4 align-top text-right">
          <span className="text-caption font-mono tnum t-secondary">{sample ? cell(sample.source_value) : '—'}</span>
        </td>
        <td className="py-3 pr-4 align-top text-right">
          <span className="text-caption font-mono tnum t-secondary">{sample ? cell(sample.target_value) : '—'}</span>
        </td>
        <td className="py-3 pr-4 align-top text-right">
          <span className="text-caption font-mono tnum" style={{ color: sample && sample.difference !== 0 ? 'var(--neg)' : 'var(--text-muted)' }}>
            {sample ? cell(sample.difference) : '—'}
          </span>
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
          <span className="text-body-sm font-mono font-semibold tnum t-primary">{formatCurrency(f.financial_impact, currency)}</span>
        </td>
      </tr>
      {isOpen && hasProvenance && (
        <tr style={{ background: 'var(--bg-secondary)' }}>
          <td />
          <td colSpan={8} className="py-4 pr-4 align-top">
            <p className="text-label mb-2" style={{ color: 'var(--text-muted)' }}>FINDING PROVENANCE · {sample?.ref ?? f.id}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {ev.pattern && <ProvRow label="Statistical basis" value={ev.pattern} />}
              {ev.frequency && <ProvRow label="Frequency" value={ev.frequency} />}
              {ev.first_occurrence && <ProvRow label="First occurrence" value={ev.first_occurrence} />}
              <ProvRow label="Affected records" value={f.affected_records.toLocaleString('en-ZA')} />
              {f.root_cause && <ProvRow label="Root cause" value={f.root_cause} wide />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ProvRow({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <span className="text-caption uppercase tracking-wider t-muted">{label}</span>
      <p className="text-body-sm t-secondary mt-0.5">{value}</p>
    </div>
  );
}

export default BillingProofFindings;
