/**
 * ExecutiveOverview — the board-grade dashboard spine, wired from the
 * Higgsfield "Swiss Calm Authority" render (docs/ui-redesign/higgsfield/
 * 01-dashboard.png). It is the first thing a CFO/board user sees on
 * /dashboard:
 *
 *   ┌ EXECUTIVE DASHBOARD ─────────────────────────────────────────┐
 *   │ R48.2M │ ACTIVE CATALYSTS │ AVG SAVINGS/RUN │ ROI CONFIDENCE  │
 *   │ hero   │ 124              │ R388.7k         │ 98.2% ◌ gauge   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ CUMULATIVE SAVINGS TRAJECTORY  ────────────────╱ current      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Light-only, royal-blue brand accent, hairline rules — no cards, no shadow.
 * Every figure is real: the hero is lifetime realised savings from the
 * billing summary; the gauge is the Atheon health score; the trajectory
 * is the running cumulative of the pulse history series.
 */
import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api } from '@/lib/api';
import type { BillingSummary } from '@/lib/api';
import { formatCompactCurrency } from '@/lib/format-currency';

const ACCENT = 'var(--accent)';

export interface ExecutiveOverviewProps {
  /** Active catalyst clusters. */
  activeCatalysts: number;
  /** Lifetime discrepancy value recovered (ROI engine). */
  valueRecovered: number;
  /** Total catalyst runs — denominator for avg savings / run. */
  catalystCount: number;
  /** Atheon health score 0–100, rendered as the ROI-confidence gauge. */
  overallScore: number;
  /** Pulse history series (monthly). Summed into a cumulative trajectory. */
  history: Array<{ month: string; value: number }> | null;
}

export function ExecutiveOverview({
  activeCatalysts,
  valueRecovered,
  catalystCount,
  overallScore,
  history,
}: ExecutiveOverviewProps) {
  const [billing, setBilling] = useState<BillingSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.insightsStats.billingSummary()
      .then((b) => { if (!cancelled) setBilling(b); })
      .catch(() => { /* fresh tenant — no billing yet */ });
    return () => { cancelled = true; };
  }, []);

  const recovered = billing?.total_realised_savings ?? valueRecovered;
  const avgPerRun = catalystCount > 0 ? valueRecovered / catalystCount : 0;
  // Currency is tenant-level — it rides with the billing record, so the
  // symbol always matches the figure's source. Defaults to ZAR pre-billing.
  const currency = billing?.currency ?? 'ZAR';
  const fmt = (v: number) => formatCompactCurrency(v, currency);

  // Cumulative trajectory: running sum of the monthly series so the line
  // climbs to the lifetime figure, matching the render. Falls back to an
  // empty plot (not synthesized data) when no history is available.
  let running = 0;
  const trajectory = (history ?? []).map((row) => {
    running += row.value || 0;
    return { month: row.month, cumulative: running };
  });
  const hasTrajectory = trajectory.length >= 2;

  // ROI-confidence gauge geometry (thin ring, brand blue).
  const gaugeR = 26;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeOffset = gaugeC - (Math.max(0, Math.min(100, overallScore)) / 100) * gaugeC;

  return (
    <section aria-label="Executive overview">
      {/* Masthead */}
      <p className="text-label tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
        EXECUTIVE DASHBOARD
      </p>
      <div className="mt-3" style={{ borderTop: '1.5px solid var(--line-strong)' }} />

      {/* Hero + KPI band — four cells divided by vertical hairlines */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        {/* Hero: lifetime verified savings */}
        <div className="py-7 lg:pr-8 flex items-stretch gap-4">
          <span className="w-[3px] flex-none rounded-full" style={{ background: ACCENT }} aria-hidden="true" />
          <div className="min-w-0">
            <p
              className="font-black tnum leading-[0.84] tracking-[-0.045em] t-primary"
              style={{ fontSize: 'clamp(46px,5.2vw,68px)' }}
            >
              {fmt(recovered)}
            </p>
            <p className="text-label mt-3" style={{ color: 'var(--text-muted)' }}>VERIFIED SAVINGS</p>
            <p className="text-caption t-muted mt-1.5">
              traced to ERP record across {catalystCount} catalyst run{catalystCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {/* KPI: active catalysts */}
        <KpiCell label="ACTIVE CATALYSTS" value={activeCatalysts.toLocaleString('en-ZA')} />

        {/* KPI: avg savings / run */}
        <KpiCell label="AVG SAVINGS / RUN" value={avgPerRun > 0 ? fmt(avgPerRun) : '—'} />

        {/* KPI: ROI confidence + gauge */}
        <div className="py-7 lg:pl-8 lg:border-l flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-card)' }}>
          <div className="min-w-0">
            <p className="text-label" style={{ color: 'var(--text-muted)' }}>ROI CONFIDENCE</p>
            <p className="text-figure font-bold tnum font-mono t-primary mt-2">{overallScore.toFixed(1)}%</p>
          </div>
          <svg width={64} height={64} className="-rotate-90 flex-none" aria-hidden="true">
            <circle cx={32} cy={32} r={gaugeR} fill="none" stroke="var(--border-card)" strokeWidth={4} />
            <circle
              cx={32} cy={32} r={gaugeR} fill="none" stroke={ACCENT} strokeWidth={4} strokeLinecap="round"
              strokeDasharray={gaugeC} strokeDashoffset={gaugeOffset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
        </div>
      </div>

      {/* Cumulative savings trajectory */}
      <div className="pt-6" style={{ borderTop: '1px solid var(--border-card)' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-label" style={{ color: 'var(--text-muted)' }}>CUMULATIVE SAVINGS TRAJECTORY</p>
          {hasTrajectory && (
            <p className="text-caption font-mono tnum" style={{ color: ACCENT }}>
              CURRENT · {fmt(recovered)}
            </p>
          )}
        </div>
        <div className="h-52">
          {hasTrajectory ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trajectory} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="execTrajFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  axisLine={false} tickLine={false} width={48}
                  tickFormatter={(v: number) => fmt(v)}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '2px', fontSize: '11px' }}
                  formatter={(v: number) => [fmt(v), 'Cumulative']}
                />
                <Area type="monotone" dataKey="cumulative" stroke={ACCENT} strokeWidth={2} fill="url(#execTrajFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-caption t-muted">Trajectory builds as catalyst runs close — no history yet.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A single KPI cell in the hero band — vertical hairline, label over figure. */
function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-7 lg:px-8 lg:border-l" style={{ borderColor: 'var(--border-card)' }}>
      <p className="text-label" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-figure font-bold tnum font-mono t-primary mt-2">{value}</p>
    </div>
  );
}

export default ExecutiveOverview;
