/**
 * /board-digest — Quarterly digest landing for Board Members & Audit Committee.
 *
 * Phase AU sales-unblocker: large enterprises need to be able to invite
 * Board / Audit Committee members to Atheon for quarterly review WITHOUT
 * giving them executive-grade operational access. The `board_member` role
 * (added in this phase) lands here and sees ONLY this page: the headline
 * outcomes the board cares about and nothing else.
 *
 * Surfaces, top-to-bottom:
 *   1. Shared-savings hero — Atheon recovered RX • billed RY • multiple Zx
 *   2. Atheon health score (overall + QoQ delta)
 *   3. Critical risks + active anomalies summary
 *   4. Forecast accuracy headline (within-band rate)
 *   5. Compliance posture (MFA coverage + CC6.1 status)
 *
 * Every tile carries a MetricSource so a non-technical board member can
 * still inspect the provenance behind any number.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { Numeric } from '@/components/ui/numeric';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { MetricSource, type MetricProvenance } from '@/components/ui/metric-source';
import { api, ApiError } from '@/lib/api';
import type { HealthScore, BillingSummary, ForecastAccuracyResp } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/components/ui/toast';
import { TrendingUp, ShieldCheck, Activity, FileDown } from 'lucide-react';
import { PersonaRail } from '@/components/journey/PersonaRail';

function formatCurrency(value: number, currency = 'ZAR'): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export default function BoardDigestPage(): JSX.Element {
  const toast = useToast();
  const currentUser = useAppStore((s) => s.user);
  const currentRole = currentUser?.role || 'viewer';
  const canExportDigest = ['superadmin', 'support_admin', 'admin', 'executive'].includes(currentRole);
  const canExportFullPack = ['superadmin', 'support_admin', 'admin'].includes(currentRole);

  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [forecast, setForecast] = useState<ForecastAccuracyResp | null>(null);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risksCount, setRisksCount] = useState<number>(0);
  const [anomaliesCount, setAnomaliesCount] = useState<number>(0);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPack, setExportingPack] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, f, h, r, a] = await Promise.allSettled([
        api.insightsStats.billingSummary(),
        api.insightsStats.forecastAccuracy(),
        api.apex.health(),
        api.apex.risksCount(),
        api.pulse.anomaliesCount(),
      ]);
      if (b.status === 'fulfilled') setBilling(b.value);
      if (f.status === 'fulfilled') setForecast(f.value);
      if (h.status === 'fulfilled') setHealth(h.value);
      // Uncapped totals so the on-screen figures match the digest PDF's COUNT(*)
      // even when a tenant has >50 risks/anomalies (the list endpoints page).
      if (r.status === 'fulfilled') setRisksCount(r.value.count);
      if (a.status === 'fulfilled') setAnomaliesCount(a.value.count);
      setLoadedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load digest');
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadDigest = useCallback(async () => {
    setExporting(true);
    try {
      const { id, title } = await api.boardDigest.generate();
      await api.boardDigest.downloadPdf(id, title);
    } catch (e) {
      toast.error('Failed to export digest PDF', {
        message: e instanceof ApiError ? e.message : undefined,
        requestId: e instanceof ApiError ? e.requestId : null,
      });
    } finally {
      setExporting(false);
    }
  }, [toast]);

  const downloadFullPack = useCallback(async () => {
    setExportingPack(true);
    try {
      const r = await api.boardReport.generate();
      await api.boardReport.downloadPdf(r.id, r.title);
    } catch (e) {
      toast.error('Failed to export full board pack', {
        message: e instanceof ApiError ? e.message : undefined,
        requestId: e instanceof ApiError ? e.requestId : null,
      });
    } finally {
      setExportingPack(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const status = statusFrom({ loading, error, isEmpty: false });
  if (status !== 'success') {
    return (
      <div className="p-6">
        <AsyncPageContent
          status={status}
          error={error}
          onRetry={() => void load()}
          errorTitle="Couldn't load board digest"
          loadingVariant="cards"
          loadingCount={4}
        >
          {null}
        </AsyncPageContent>
      </div>
    );
  }

  const recovered = billing?.total_realised_savings ?? 0;
  const billed = billing?.total_atheon_revenue ?? 0;
  const multiple = billed > 0 ? recovered / billed : 0;
  const currency = billing?.currency ?? 'ZAR';
  const overallScore = Math.round(health?.overall ?? 0);
  const withinBand = forecast?.within_band_rate;

  const baseProvenance: Partial<MetricProvenance> = {
    refreshedAt: loadedAt,
    window: 'Cumulative since first sync',
  };

  const refreshedLabel = loadedAt
    ? new Date(loadedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" data-testid="board-digest-page">
      {/* Editorial masthead — the digest reads as a confidential board document.
          Big editorial title on the left, the single verified hero figure on
          the right. The mono eyebrow row is the document's "classification"
          strip. Export actions stay top-right of the page chrome. */}
      <div className="flex items-center justify-end gap-2 mb-4">
        {canExportDigest && (
          <Button
            variant="primary"
            size="sm"
            loading={exporting}
            leading={<FileDown size={14} />}
            onClick={() => { void downloadDigest(); }}
            data-testid="board-digest-download"
          >
            Download PDF
          </Button>
        )}
        {canExportFullPack && (
          <Button
            variant="ghost"
            size="sm"
            loading={exportingPack}
            leading={<FileDown size={14} />}
            onClick={() => { void downloadFullPack(); }}
            data-testid="board-digest-fullpack"
          >
            Full board pack
          </Button>
        )}
      </div>

      {/* Read-only CEO lens for the board — picker hidden (spec 2026-07-14 §4.7). */}
      <PersonaRail user={currentUser} fixedPersona="ceo" />

      <header
        className="card-hero p-7 md:p-9 mb-6"
        data-testid="board-digest-hero"
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <h1 className="font-mono font-bold tracking-tight t-primary text-2xl md:text-[2.1rem] leading-none uppercase">
                Board Digest
              </h1>
              <StatusPill status="verified" size="sm" />
            </div>
            <p className="text-label text-[11px] tracking-[0.18em]">
              Financial Assurance · Confidential · Atheon Luminous
            </p>
          </div>

          <div className="lg:text-right shrink-0">
            <p className="hero-eyebrow flex items-center lg:justify-end gap-2 mb-2">
              <TrendingUp size={11} aria-hidden="true" />
              Shared Savings · Lifetime
            </p>
            <div className="flex items-baseline lg:justify-end gap-2">
              <p className="text-hero t-primary">{formatCurrency(recovered, currency)}</p>
              <MetricSource source={{
                ...baseProvenance,
                label: 'Total realised savings',
                definition: 'Cumulative operator-confirmed savings across every closed billing period. Each Rand traces to a catalyst action and a source ERP record.',
                table: 'billable_periods',
                endpoint: 'GET /api/insights-stats/billing/summary',
                query: 'SUM(realised_savings_zar) FROM billable_periods',
                notes: [{ label: 'Currency', value: currency }],
              }} />
            </div>
            <p className="text-body-sm t-muted mt-1">Total verified savings &amp; recovery — since first sync</p>
          </div>
        </div>
      </header>

      {/* Two-column editorial body. Left narrative column carries the
          shared-savings ledger + compliance posture prose. Right column is
          the data rail: KPI strip, then forecast quality, then a closing
          report action. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-6">

        {/* ── Narrative column ─────────────────────────────────────── */}
        <Card className="p-6 md:p-7">
          <div className="flex items-center gap-2 pb-4 mb-5 border-b border-theme-subtle">
            <span className="text-label">Executive Narrative</span>
            <span className="text-label text-[10px] tracking-[0.14em] t-muted">· Shared-Savings Ledger</span>
          </div>

          <h2 className="text-headline-lg font-semibold t-primary mb-4">
            Recovered for the business since first sync
          </h2>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-theme-subtle">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-label">Atheon Billed</span>
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Atheon revenue (shared-savings share)',
                    definition: 'Atheon revenue invoiced under the shared-savings model: contracted % × realised savings. Customer banks the savings first; Atheon bills after.',
                    table: 'billable_periods',
                    endpoint: 'GET /api/insights-stats/billing/summary',
                    query: 'SUM(atheon_revenue_zar) FROM billable_periods',
                    notes: [{ label: 'Model', value: 'shared-savings (no upfront fee)' }],
                  }} />
                </div>
                <p className="text-body-sm t-muted mt-0.5">Invoiced under shared-savings (no upfront fee)</p>
              </div>
              <p className="text-headline-md font-semibold t-primary tabular-nums font-mono shrink-0">{formatCurrency(billed, currency)}</p>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-label">ROI Multiple</span>
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'ROI multiple',
                    definition: 'Recovered ÷ billed. The headline outcome metric the audit committee tracks each quarter.',
                    query: 'total_realised_savings / NULLIF(total_atheon_revenue, 0)',
                  }} />
                </div>
                <p className="text-body-sm t-muted mt-0.5">Recovered ÷ billed — the audit-committee headline</p>
              </div>
              <p className="text-headline-md font-semibold text-accent tabular-nums font-mono shrink-0">{multiple > 0 ? `${multiple.toFixed(1)}×` : '—'}</p>
            </div>
          </div>

          <div className="mt-7 pt-5 border-t border-theme-subtle">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={15} className="text-accent" />
              <span className="text-label">Compliance Posture</span>
              <MetricSource source={{
                ...baseProvenance,
                label: 'Compliance posture',
                definition: 'High-level SOC 2 + POPIA posture. Detailed evidence pack is in /compliance (auditor + admin only).',
                endpoint: 'GET /api/compliance/evidence-pack',
                notes: [{ label: 'Detail access', value: 'Auditor + Admin roles only' }],
              }} />
            </div>
            <p className="text-body-sm t-secondary leading-relaxed">
              Atheon enforces SOC 2 CC6.1 (MFA), CC6.2 (access reviews), and CC7.3 (incident response).
              Detailed evidence is available to your internal audit team via the Auditor role — ask the
              platform admin to issue read-only credentials.
            </p>
          </div>

          {refreshedLabel && (
            <p className="text-label text-[10px] tracking-[0.12em] t-muted mt-6">
              Refreshed {refreshedLabel}
            </p>
          )}
        </Card>

        {/* ── Data rail ────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* KPI strip */}
          <Card className="p-6">
            <div className="flex items-center gap-2 pb-4 mb-5 border-b border-theme-subtle">
              <span className="text-label">KPI Strip</span>
              <span className="text-label text-[10px] tracking-[0.14em] t-muted">· Health · Risk · Anomalies</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-label text-[10px]">Atheon Score</span>
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Atheon Score',
                    definition: 'Composite health score across every monitored business dimension (0–100).',
                    table: 'health_scores',
                    endpoint: 'GET /api/apex/health',
                    window: 'Latest snapshot',
                  }} />
                </div>
                <p className="text-headline-xl font-bold t-primary tabular-nums font-mono leading-none">
                  {overallScore}<span className="text-body-sm font-normal t-muted ml-0.5">/100</span>
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-label text-[10px]">Critical Risks</span>
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Critical risks',
                    definition: 'Open business risks flagged by Apex still requiring action.',
                    table: 'apex_risks',
                    endpoint: 'GET /api/apex/risks',
                    query: "COUNT(*) FROM apex_risks WHERE status IN ('open','monitoring')",
                    sample: risksCount,
                  }} />
                </div>
                <p className="text-headline-xl font-bold tabular-nums font-mono leading-none" style={{ color: risksCount === 0 ? 'var(--positive)' : risksCount > 3 ? 'var(--neg)' : 'var(--warning)' }}>{risksCount}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-label text-[10px]">Active Anomalies</span>
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Active anomalies',
                    definition: 'Statistical anomalies detected by Pulse that have not yet been acknowledged.',
                    table: 'pulse_anomalies',
                    endpoint: 'GET /api/pulse/anomalies',
                    query: "COUNT(*) FROM pulse_anomalies WHERE status = 'active'",
                    sample: anomaliesCount,
                  }} />
                </div>
                <p className="text-headline-xl font-bold tabular-nums font-mono leading-none" style={{ color: anomaliesCount === 0 ? 'var(--positive)' : 'var(--warning)' }}>{anomaliesCount}</p>
              </div>
            </div>
          </Card>

          {/* Forecast quality */}
          <Card className="p-6">
            <div className="flex items-center gap-2 pb-4 mb-5 border-b border-theme-subtle">
              <Activity size={15} className="text-accent" />
              <span className="text-label">Forecast Accuracy</span>
              <MetricSource source={{
                ...baseProvenance,
                label: 'Forecast within-band rate',
                definition: 'Share of graded forecasts whose actual outcome landed inside the predicted confidence interval. Higher = more trustworthy forecasts.',
                table: 'forecasts',
                endpoint: 'GET /api/insights-stats/forecast/accuracy',
                window: `Last ${forecast?.lookback_days ?? 90} days`,
                sample: forecast?.total_graded ?? 0,
              }} />
            </div>
            {forecast && forecast.total_graded > 0 ? (
              <div className="flex items-baseline gap-3">
                <span className="text-hero text-accent leading-none">
                  {withinBand != null ? `${(withinBand * 100).toFixed(1)}%` : '—'}
                </span>
                <span className="text-caption t-muted">
                  across <Numeric value={forecast.total_graded} size="sm" /> graded forecasts (last {forecast.lookback_days}d)
                </span>
              </div>
            ) : (
              <p className="text-body-sm t-muted">No forecasts have elapsed yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
