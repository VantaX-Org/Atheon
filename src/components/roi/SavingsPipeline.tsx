/**
 * SavingsPipeline — the "SAVINGS PIPELINE / ROI TRACKING" spine from the
 * Higgsfield render (docs/ui-redesign/higgsfield/02-pipeline.png), wired to
 * real ROI-tracking data:
 *
 *   IDENTIFIED ──▸ VERIFIED ──▸ RECOVERED          6.2×
 *   R71.4M        R52.0M        R48.2M              RETURN MULTIPLE
 *
 *   SAVINGS BY DOMAIN (bars)        BY CONNECTION (table)
 *
 * Honest mapping — every figure is a real ROITrackingResponse field, no
 * fabricated middle stage:
 *   IDENTIFIED = totalDiscrepancyValueIdentified (total opportunity)
 *   VERIFIED   = recovered + pending-queue value (contracted / in-flight)
 *   RECOVERED  = totalDiscrepancyValueRecovered (realized)
 * The funnel is clamped so it never widens (verified ≤ identified, etc.).
 * BY CONNECTION shows each connection's contribution `share`, labelled as
 * Share — NOT a fabricated confidence %.
 */
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { ROITrackingResponse } from '@/lib/api';

const ACCENT = 'var(--accent)';

function compactR(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R${(value / 1_000).toFixed(1)}k`;
  return `R${Math.round(value).toLocaleString('en-ZA')}`;
}

export function SavingsPipeline() {
  const [roi, setRoi] = useState<ROITrackingResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.roi.get()
      .then((r) => { if (!cancelled) setRoi(r); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;
  if (!roi) {
    return <div className="h-44 rounded animate-pulse" style={{ background: 'var(--border-card)' }} aria-hidden="true" />;
  }

  const identified = roi.totalDiscrepancyValueIdentified ?? 0;
  const recovered = roi.totalDiscrepancyValueRecovered ?? 0;
  const pending = roi.breakdown?.byActionState?.pending_value_zar ?? 0;
  // Verified = everything contracted/in-flight (realized + still in the
  // approval queue), clamped to the funnel so it never exceeds identified
  // nor drops below recovered.
  const verified = Math.min(identified, Math.max(recovered, recovered + pending));
  const multiple = roi.roiMultiple ?? 0;

  const stages = [
    { label: 'IDENTIFIED', value: identified, caption: 'TOTAL OPPORTUNITY' },
    { label: 'VERIFIED', value: verified, caption: 'CONTRACTED / IN-FLIGHT' },
    { label: 'RECOVERED', value: recovered, caption: 'REALIZED SAVINGS' },
  ];

  const byDomain = [...(roi.breakdown?.byCluster ?? [])]
    .sort((a, b) => b.recovered - a.recovered)
    .slice(0, 5);
  const domainMax = byDomain.reduce((m, d) => Math.max(m, d.recovered), 0) || 1;

  const byConnection = [...(roi.breakdown?.byConnection ?? [])]
    .sort((a, b) => b.recoveredValue - a.recoveredValue)
    .slice(0, 5);

  return (
    <section aria-label="Savings pipeline" className="space-y-7">
      {/* Funnel: identified ▸ verified ▸ recovered */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-4 md:gap-2">
        {stages.map((s, i) => (
          <FunnelStage key={s.label} stage={s} isLast={i === stages.length - 1} />
        )).reduce<React.ReactNode[]>((acc, node, i) => {
          acc.push(node);
          if (i < stages.length - 1) {
            acc.push(
              <ArrowRight key={`arr-${i}`} size={22} className="mx-auto hidden md:block" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            );
          }
          return acc;
        }, [])}
      </div>

      {/* Return multiple + by-domain + by-connection */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1.1fr_1.4fr] gap-7 pt-6" style={{ borderTop: '1px solid var(--border-card)' }}>
        {/* Return multiple */}
        <div className="flex flex-col justify-center">
          <p className="font-black tnum leading-[0.82] tracking-[-0.05em] t-primary" style={{ fontSize: 'clamp(44px,5vw,68px)' }}>
            {multiple > 0 ? `${multiple.toFixed(1)}×` : '—'}
          </p>
          <p className="text-label mt-2" style={{ color: 'var(--text-muted)' }}>RETURN MULTIPLE</p>
        </div>

        {/* Savings by domain */}
        <div>
          <p className="text-label mb-3" style={{ color: 'var(--text-muted)' }}>SAVINGS BY DOMAIN</p>
          {byDomain.length === 0 ? (
            <p className="text-caption t-muted">No domain attribution yet.</p>
          ) : (
            <div className="space-y-2.5">
              {byDomain.map((d) => (
                <div key={d.clusterId} className="flex items-center gap-3">
                  <span className="text-caption t-secondary w-32 truncate shrink-0">{d.clusterName}</span>
                  <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="h-full rounded-sm" style={{ width: `${(d.recovered / domainMax) * 100}%`, background: ACCENT }} />
                  </div>
                  <span className="text-caption font-mono tnum t-secondary w-16 text-right shrink-0">{compactR(d.recovered)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By connection */}
        <div>
          <p className="text-label mb-3" style={{ color: 'var(--text-muted)' }}>BY CONNECTION</p>
          {byConnection.length === 0 ? (
            <p className="text-caption t-muted">No per-connection attribution yet.</p>
          ) : (
            <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="text-label" style={{ color: 'var(--text-muted)' }}>
                  <th className="pb-2 pr-3 font-medium">Connection</th>
                  <th className="pb-2 pr-3 font-medium text-right">Identified</th>
                  <th className="pb-2 pr-3 font-medium text-right">Recovered</th>
                  <th className="pb-2 font-medium text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {byConnection.map((c) => (
                  <tr key={c.key} style={{ borderTop: '1px solid var(--divider)' }}>
                    <td className="py-2 pr-3 text-caption t-secondary truncate max-w-[10rem]">{c.label}</td>
                    <td className="py-2 pr-3 text-caption font-mono tnum t-secondary text-right">{compactR(c.inputValue)}</td>
                    <td className="py-2 pr-3 text-caption font-mono tnum t-primary text-right">{compactR(c.recoveredValue)}</td>
                    <td className="py-2 text-caption font-mono tnum text-right" style={{ color: ACCENT }}>{(c.share * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

function FunnelStage({ stage, isLast }: { stage: { label: string; value: number; caption: string }; isLast: boolean }) {
  return (
    <div className="text-center">
      <p className="text-label" style={{ color: 'var(--text-muted)' }}>{stage.label}</p>
      <p
        className="font-black tnum leading-[0.85] tracking-[-0.045em] mt-1.5"
        style={{ fontSize: 'clamp(34px,4vw,52px)', color: isLast ? ACCENT : 'var(--text-primary)' }}
      >
        {compactR(stage.value)}
      </p>
      <p className="text-caption t-muted mt-1.5">{stage.caption}</p>
    </div>
  );
}

export default SavingsPipeline;
