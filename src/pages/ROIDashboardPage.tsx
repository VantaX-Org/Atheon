/**
 * ROI / Insights Dashboard — Phase 10-23.
 *
 * Surfaces the new Phase 10-9 → 10-22 outputs that the backend now
 * produces but had no UI:
 *
 *   - Cumulative shared-savings (billable_periods totals + Atheon
 *     revenue at the configured share %)
 *   - Forecast accuracy (within-band rate + median absolute error %,
 *     overall + per horizon)
 *
 * CFO pass (2026-07): this screen answers exactly three questions —
 * how much did we get back, what did it cost, can I defend this number.
 * Inference calibration + DSAR tables were cut as engine/compliance
 * noise (re-home them on Trust/Compliance pages). Fee is always shown
 * explicitly next to recovered — never netted silently.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { JourneyStageBar } from '@/components/journey/JourneyStageBar';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { MetricSource, type MetricProvenance } from '@/components/ui/metric-source';
import { SavingsPipeline } from '@/components/roi/SavingsPipeline';
import { useToast } from '@/components/ui/toast';
import { TrendingUp, Activity, CheckCircle2, Download, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { BillingSummary, ForecastAccuracyResp } from '@/lib/api';

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export default function ROIDashboardPage(): JSX.Element {
  const toast = useToast();
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [forecast, setForecast] = useState<ForecastAccuracyResp | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Freshness marker for MetricSource popovers on every billing/forecast tile.
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  // Stable loader so the error retry button can re-invoke without
  // racing the cancelled flag below.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // SDK-only — raw api.get('/path') is banned per UI_POLISH_PRINCIPLES §6.1.
      // Adding a new endpoint? Add it to api.insightsStats first, then
      // consume the typed method here.
      const [b, f] = await Promise.all([
        api.insightsStats.billingSummary(),
        api.insightsStats.forecastAccuracy(),
      ]);
      setBilling(b);
      setForecast(f);
      setLoadedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auditor-grade proof export: per-period rows straight from the typed
  // /api/roi/export contract (no client-side invention — every cell is a
  // real API field), serialised to CSV in the browser.
  const exportProof = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { export: rows, currency } = await api.roi.exportCsv();
      if (rows.length === 0) {
        toast.info('Nothing to export', 'No ROI periods recorded yet.');
        return;
      }
      const cols = Object.keys(rows[0]);
      const csv = [
        [...cols, 'currency'].join(','),
        ...rows.map((r) => [...cols.map((k) => String(r[k] ?? '')), currency].join(',')),
      ].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `atheon-savings-proof-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error('Export failed', e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  // Canonical render-state contract (UI_POLISH_PRINCIPLES §6.1):
  //   1. loading → LoadingState
  //   2. error + no data → ErrorState with retry
  //   3. otherwise → real content
  const status = statusFrom({ loading, error: error && !billing ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <div className="p-6">
        <AsyncPageContent
          status={status}
          error={error}
          onRetry={() => void load()}
          errorTitle="Couldn't load ROI dashboard"
          loadingVariant="cards"
          loadingCount={3}
        >
          {null}
        </AsyncPageContent>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Journey · 04 Recover"
        title="Savings"
        dek="What was recovered, what Atheon billed, and the proof behind every Rand"
        actions={
          <Button
            variant="secondary"
            size="sm"
            leading={<Download size={13} />}
            loading={exporting}
            onClick={() => void exportProof()}
          >
            Export proof (CSV)
          </Button>
        }
      />
      <JourneyStageBar current="recover" />

      {/* Wave H-3: ROI's anchor IS the realised-savings figure — the whole
          page exists to prove "you banked R{X} before we billed you R{Y}".
          Removed the slim SharedSavingsStrip (was redundant — strip and
          billing card surfaced the same data). Promoted the realised-
          savings figure to .text-hero with Periods/Atheon share/Multiple
          as supporting metrics in the ledger column. */}
      {billing ? (() => {
        const billingBase: Partial<MetricProvenance> = {
          endpoint: 'GET /api/insights-stats/billing/summary',
          refreshedAt: loadedAt,
          window: 'All elapsed billable periods',
        };
        const multiple = billing.total_atheon_revenue > 0
          ? billing.total_realised_savings / billing.total_atheon_revenue
          : 0;
        const netBenefit = billing.total_realised_savings - billing.total_atheon_revenue;
        return (
          <div className="card-hero p-7 md:p-8" data-testid="roi-hero">
            <p className="hero-eyebrow flex items-center gap-2 mb-3">
              <TrendingUp size={11} aria-hidden="true" />
              Shared-Savings · Lifetime
            </p>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 mb-1.5">
                  <p className="text-hero t-primary">{formatCurrency(billing.total_realised_savings, billing.currency)}</p>
                  <CheckCircle2 size={20} aria-hidden="true" style={{ color: 'var(--rag-healthy)' }} className="shrink-0 self-center" />
                  <MetricSource source={{
                    ...billingBase,
                    label: 'Total realised savings',
                    definition: 'Cumulative sum of operator-confirmed savings across every closed billing period. Each Rand traces to an ERP record via the catalyst action that produced it.',
                    table: 'billable_periods',
                    query: 'SUM(realised_savings_zar) FROM billable_periods WHERE tenant_id = ? AND status = graded',
                    notes: [
                      { label: 'Currency', value: billing.currency },
                      { label: 'Trace', value: 'every Rand → catalyst_actions.value_zar → source_finding_id' },
                    ],
                    drillTo: '/action-layer?status=completed',
                  }} />
                </div>
                <p className="text-body-sm t-muted">Recovered for the business across every elapsed billing period</p>
              </div>
              {/* Shared-savings transparency: the fee sits right next to the
                  recovered figure, never netted silently. Net benefit and the
                  ROI multiple are pure arithmetic on the same two API fields. */}
              <div className="md:text-right shrink-0 grid grid-cols-2 md:grid-cols-1 gap-3 md:gap-2">
                <div>
                  <div className="flex items-center md:justify-end gap-1.5">
                    <span className="text-label">Atheon fee billed</span>
                    <MetricSource source={{
                      ...billingBase,
                      label: 'Atheon fee billed (shared-savings share)',
                      definition: 'Atheon revenue from the shared-savings billing model: contracted share % × realised savings. Every Rand here is a Rand the customer banked in their ERP first.',
                      table: 'billable_periods',
                      query: 'SUM(atheon_revenue_zar) FROM billable_periods WHERE tenant_id = ?',
                      notes: [
                        { label: 'Currency', value: billing.currency },
                        { label: 'Model', value: 'shared-savings (contracted %)' },
                      ],
                    }} />
                  </div>
                  <p className="text-headline-md font-semibold text-accent tabular-nums font-mono mt-0.5">
                    {formatCurrency(billing.total_atheon_revenue, billing.currency)}
                  </p>
                </div>
                <div>
                  <div className="flex items-center md:justify-end gap-1.5">
                    <span className="text-label">Net benefit</span>
                    <MetricSource source={{
                      ...billingBase,
                      label: 'Net benefit',
                      definition: 'Realised savings minus the Atheon fee — what the business keeps after Atheon is paid.',
                      table: 'billable_periods',
                      query: 'SUM(realised_savings_zar) - SUM(atheon_revenue_zar) FROM billable_periods WHERE tenant_id = ?',
                    }} />
                  </div>
                  <p className="text-headline-md font-semibold t-primary tabular-nums font-mono mt-0.5">
                    {formatCurrency(netBenefit, billing.currency)}
                  </p>
                </div>
                <div>
                  <div className="flex items-center md:justify-end gap-1.5">
                    <span className="text-label">ROI multiple</span>
                    <MetricSource source={{
                      ...billingBase,
                      label: 'ROI multiple',
                      definition: 'Recovered ÷ billed. The headline outcome metric the audit committee tracks each quarter.',
                      query: 'total_realised_savings / NULLIF(total_atheon_revenue, 0)',
                    }} />
                  </div>
                  <p className="text-headline-md font-semibold text-accent tabular-nums font-mono mt-0.5">
                    {multiple > 0 ? `${multiple.toFixed(1)}×` : '—'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center md:justify-end gap-1.5">
                    <span className="text-label">Periods billed</span>
                    <MetricSource source={{
                      ...billingBase,
                      label: 'Periods invoiced',
                      definition: 'Number of distinct billing periods that have completed and produced an invoice line.',
                      table: 'billable_periods',
                      query: 'COUNT(*) FROM billable_periods WHERE tenant_id = ? AND status IN (graded, invoiced)',
                      sample: billing.periods_count,
                    }} />
                  </div>
                  <p className="text-headline-md font-semibold t-primary tabular-nums font-mono mt-0.5">{billing.periods_count}</p>
                </div>
              </div>
            </div>
            {/* Defend-the-number tools + forward motion to stage 05 Reports. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 pt-4" style={{ borderTop: '1px solid var(--border-card)' }}>
              <Link to="/catalysts?tab=value-ledger" className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline">
                Open recovery ledger — every period, line item & audit pack <ArrowRight size={12} aria-hidden="true" />
              </Link>
              {billing.total_realised_savings > 0 && (
                <Link to="/executive-summary" className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline">
                  Take it to the board — executive summary <ArrowRight size={12} aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        );
      })() : (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={18} style={{ color: 'var(--accent)' }} />
            <h2 className="text-headline-md font-semibold t-primary">Shared-savings billing</h2>
          </div>
          <div className="text-sm t-muted">
            No completed billing periods yet. Under shared savings you are only billed after value is
            recovered — <Link to="/catalysts" className="text-accent hover:underline">approve fixes</Link> to
            start recovering.
          </div>
        </Card>
      )}

      {/* Savings pipeline / ROI tracking — Higgsfield render 02
          (docs/ui-redesign/higgsfield/02-pipeline.png) wired to api.roi.get():
          identified ▸ verified ▸ recovered funnel + return multiple +
          savings-by-domain bars + per-connection attribution. */}
      <Card className="p-6 md:p-7">
        <SavingsPipeline />
      </Card>

      {/* Forecast accuracy */}
      <Card className="p-6 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={13} style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <h2 className="text-label">Forecast Accuracy</h2>
        </div>
        <p className="text-body-sm t-muted mb-5">Within-band rate over the last {forecast?.lookback_days ?? 90} days</p>
        {forecast && forecast.total_graded > 0 ? (() => {
          const forecastBase: Partial<MetricProvenance> = {
            endpoint: 'GET /api/insights-stats/forecast/accuracy',
            refreshedAt: loadedAt,
            window: `Last ${forecast.lookback_days ?? 90} days`,
          };
          return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors active:scale-[0.97]">
                <div className="flex items-center justify-between">
                  <div className="text-label">Graded forecasts</div>
                  <MetricSource source={{
                    ...forecastBase,
                    label: 'Graded forecasts',
                    definition: 'Number of forecasts whose target horizon has elapsed, so an actual outcome was available to compare against.',
                    table: 'forecasts',
                    query: 'COUNT(*) FROM forecasts WHERE tenant_id = ? AND graded_at IS NOT NULL',
                    sample: forecast.total_graded,
                  }} />
                </div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{forecast.total_graded}</p>
              </div>
              <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors active:scale-[0.97]">
                <div className="flex items-center justify-between">
                  <div className="text-label">Within band</div>
                  <MetricSource source={{
                    ...forecastBase,
                    label: 'Forecast within-band rate',
                    definition: 'Share of graded forecasts whose actual outcome landed inside the predicted confidence interval.',
                    table: 'forecasts',
                    query: 'SUM(within_band = 1) / COUNT(*) FROM forecasts WHERE graded_at IS NOT NULL',
                    sample: forecast.total_graded,
                  }} />
                </div>
                <p className="text-headline-lg font-bold text-accent tabular-nums font-mono mt-1">
                  {forecast.within_band_rate != null
                    ? `${(forecast.within_band_rate * 100).toFixed(1)}%`
                    : '—'}
                </p>
              </div>
              <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors active:scale-[0.97]">
                <div className="flex items-center justify-between">
                  <div className="text-label">Median |error| %</div>
                  <MetricSource source={{
                    ...forecastBase,
                    label: 'Forecast median absolute error %',
                    definition: 'Median of |forecast − actual| / actual across all graded forecasts. Lower is better.',
                    table: 'forecasts',
                    query: 'MEDIAN(ABS(forecast - actual) / NULLIF(actual, 0)) * 100',
                    sample: forecast.total_graded,
                  }} />
                </div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">
                  {forecast.median_abs_error_pct != null
                    ? `${forecast.median_abs_error_pct.toFixed(2)}%`
                    : '—'}
                </p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-label">
                  <th className="pb-2 font-medium">Horizon</th>
                  <th className="pb-2 font-medium text-right">Graded</th>
                  <th className="pb-2 font-medium text-right">Within band</th>
                  <th className="pb-2 font-medium text-right">Median |error|</th>
                </tr>
              </thead>
              <tbody>
                {forecast.by_horizon.map((h) => (
                  <tr key={h.horizon_days} className="border-t border-[var(--divider)]">
                    <td className="py-2 font-mono tabular-nums t-secondary">{h.horizon_days}d</td>
                    <td className="py-2 font-mono tabular-nums t-secondary text-right">{h.graded}</td>
                    <td className="py-2 font-mono tabular-nums t-primary text-right">{h.within_band_rate != null ? `${(h.within_band_rate * 100).toFixed(1)}%` : '—'}</td>
                    <td className="py-2 font-mono tabular-nums t-secondary text-right">{h.median_abs_error_pct != null ? `${h.median_abs_error_pct.toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
          );
        })() : <div className="text-sm t-muted">No forecasts have elapsed yet.</div>}
      </Card>
    </div>
  );
}
