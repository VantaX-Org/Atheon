/**
 * §11.8 Executive Summary / Briefing
 *
 * Single-endpoint view — pulls the pre-aggregated executive summary from
 * GET /api/executive-summary (backend: workers/api/src/routes/executive-summary.ts)
 * in one round-trip. Load target: < 2s.
 *
 * Route: /executive-summary | Role: superadmin, support_admin, admin, executive
 *
 * The endpoint is DB-backed (NOT LLM-backed), so it does not throw 429 budget
 * errors. We still handle generic ApiError with a requestId-aware toast.
 *
 * Scheduling / distribution (per audit notes): NOT YET IMPLEMENTED. We surface
 * a hint card where those would live, so the gap is visible in the UI rather
 * than a silent 404.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAppStore, useTenantCurrency } from '@/stores/appStore';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { PageHeader } from '@/components/ui/page-header';
import { JourneyStageBar } from '@/components/journey/JourneyStageBar';
import { Sparkline } from '@/components/ui/sparkline';
import { SharedSavingsStrip } from '@/components/SharedSavingsStrip';
import { FindingsReviewTable } from '@/components/dashboard/FindingsReviewTable';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { formatCompactCurrency } from '@/lib/format-currency';
import type { ExecutiveSummaryResponse } from '@/lib/api';
import {
  AlertCircle, TrendingUp,
  TrendingDown, Minus, RefreshCw, ArrowRight,
} from 'lucide-react';

const targetStatusColor = (s: string): 'success' | 'warning' | 'danger' | 'info' => {
  const v = (s || '').toLowerCase();
  if (v === 'on_track' || v === 'achieved' || v === 'active') return 'success';
  if (v === 'at_risk' || v === 'warning') return 'warning';
  if (v === 'off_track' || v === 'missed') return 'danger';
  return 'info';
};

export function ExecutiveSummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const currency = useTenantCurrency();
  const [data, setData] = useState<ExecutiveSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await api.executiveSummary.get();
      setData(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load executive summary';
      setError(message);
      toast.error('Failed to load executive summary', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const status = statusFrom({ loading, error: error && !data ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        error={error}
        onRetry={() => void load()}
        errorTitle="Couldn't load executive summary"
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  if (!data) return null;

  const improvement = data.journey?.improvement;
  const improvementIcon = improvement === null || improvement === undefined
    ? <Minus className="w-4 h-4 t-muted" />
    : improvement > 0
      ? <TrendingUp className="w-4 h-4" style={{ color: 'var(--positive)' }} />
      : improvement < 0
        ? <TrendingDown className="w-4 h-4" style={{ color: 'var(--neg)' }} />
        : <Minus className="w-4 h-4 t-muted" />;

  const dimensionEntries = Object.entries(data.dimensions || {});
  const trendValues = (data.trend || []).map(t => t.score);

  const healthHealthy = (data.healthScore ?? 0) >= 80;
  const healthWatch = (data.healthScore ?? 0) >= 50 && (data.healthScore ?? 0) < 80;
  const healthOrbColor = healthHealthy
    ? 'var(--rag-healthy)'
    : healthWatch
      ? 'var(--warning)'
      : 'var(--neg)';

  return (
    <div className="space-y-6 animate-fadeIn">
      <SharedSavingsStrip />

      <PageHeader
        eyebrow="Journey · 05 Report"
        title="Reports"
        dek={`One-page executive & board briefing for ${user?.name?.split(' ')[0] || 'executives'} — aggregated from health, savings, diagnostics & signals`}
        actions={
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--bg-secondary)] text-xs t-muted hover:t-primary transition-colors"
            aria-label="Refresh executive summary"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />
      <JourneyStageBar current="report" />

      {/* Editorial two-rail briefing (Higgsfield render v4-02). Left rail
          anchors the dollar story (hero savings + supporting stat cards);
          right rail carries the narrative ("Key Outcomes") plus the value
          realization trend and a prepared-for masthead. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── LEFT RAIL: the dollar anchor ─────────────────────────── */}
        <div className="lg:col-span-3 space-y-5">
          {/* Hero — Verified Savings (YTD) */}
          <div className="card-hero p-7 md:p-8" data-testid="exec-summary-hero">
            <p className="hero-eyebrow flex items-center gap-2 mb-3">
              <TrendingUp size={11} aria-hidden="true" />
              Verified Savings · YTD
            </p>
            <p className="text-hero t-primary leading-none">
              {formatCompactCurrency(data.roi?.recovered ?? 0, currency)}
            </p>
            <p className="text-body-sm t-muted mt-3">
              {data.roi?.multiple ? `${data.roi.multiple.toFixed(1)}× ROI · traced to ERP records` : 'Awaiting first catalyst'}
            </p>
          </div>

          {/* Supporting stat cards — Atheon score + Health (with status orb) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Card className="p-6 flex flex-col justify-between">
              <div>
                <p className="text-hero t-primary leading-none tabular-nums">{data.atheonScore ?? '—'}</p>
                <p className="text-label mt-3">Atheon Score</p>
              </div>
              <p className="text-caption t-muted mt-2">Composite across 5 health pillars</p>
            </Card>

            <Card className="p-6 flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-hero t-primary leading-none tabular-nums">{data.healthScore ?? '—'}</p>
                  <p className="text-label mt-3">Health Score</p>
                </div>
                <span
                  aria-hidden="true"
                  className="shrink-0 w-12 h-12 rounded-full mt-1"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${healthOrbColor} 60%, white), ${healthOrbColor})`,
                    boxShadow: `0 0 20px 2px color-mix(in srgb, ${healthOrbColor} 45%, transparent)`,
                  }}
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                {trendValues.length > 1 ? (
                  <>
                    <Sparkline data={trendValues} width={72} height={20} />
                    <span className="text-caption t-muted">last {trendValues.length} pts</span>
                  </>
                ) : (
                  <span className="text-caption t-muted">No trend yet</span>
                )}
              </div>
            </Card>
          </div>

          {/* Journey delta — slim ledger row under the stat pair */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-label">Journey vs Baseline</p>
              {data.journey?.baselineHealthScore !== null && data.journey?.baselineHealthScore !== undefined ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-headline-md font-semibold t-primary tabular-nums font-mono">
                    {improvement !== null && improvement !== undefined && improvement > 0 ? '+' : ''}{improvement ?? 0}
                  </span>
                  {improvementIcon}
                  <span className="text-caption t-muted ml-1">vs baseline {data.journey.baselineHealthScore}</span>
                </div>
              ) : (
                <span className="text-body-sm t-muted">No baseline captured</span>
              )}
            </div>
          </Card>

          {/* Diagnostic KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <p className="text-headline-xl t-primary tabular-nums font-mono">{data.diagnostics?.activeRcas ?? 0}</p>
              <p className="text-label mt-2">Active RCAs</p>
              <p className="text-caption t-muted mt-1">Root-cause investigations</p>
            </Card>
            <Card className="p-4">
              <p className="text-headline-xl t-primary tabular-nums font-mono">{data.diagnostics?.pendingPrescriptions ?? 0}</p>
              <p className="text-label mt-2">Pending Rx</p>
              <p className="text-caption t-muted mt-1">Awaiting action</p>
            </Card>
            <Card className="p-4">
              <p className="text-headline-xl t-primary tabular-nums font-mono">{data.signals?.newThisWeek ?? 0}</p>
              <p className="text-label mt-2">Signals · 7d</p>
              <p className="text-caption t-muted mt-1">External radar</p>
            </Card>
          </div>
        </div>

        {/* ── RIGHT RAIL: the narrative ────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Key Outcomes & Strategic Insights — top risks as the briefing list */}
          <Card className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-headline-sm t-primary">Key Outcomes &amp; Strategic Insights</h3>
              <button onClick={() => navigate('/apex')} className="text-caption text-accent hover:underline inline-flex items-center gap-1 shrink-0">
                All risks <ArrowRight size={11} />
              </button>
            </div>
            {data.topRisks && data.topRisks.length > 0 ? (
              <ul className="space-y-3">
                {data.topRisks.map((risk, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" style={{
                      color: risk.severity === 'critical' ? 'var(--neg)' :
                        risk.severity === 'high' ? 'var(--neg)' : 'var(--warning)',
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-body-sm font-medium t-primary">{risk.title}</p>
                        <StatusPill status={risk.severity} size="sm" />
                      </div>
                      {!!risk.impactValue && (
                        <p className="text-caption t-muted mt-0.5">
                          Est. impact {formatCompactCurrency(risk.impactValue, currency)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm t-muted py-2">No active high-priority risks. Nice work.</p>
            )}
          </Card>

          {/* Value Realization Trend */}
          {trendValues.length > 1 && (
            <Card className="p-5 md:p-6">
              <p className="text-label mb-3">Value Realization Trend</p>
              <Sparkline data={trendValues} width={260} height={72} className="w-full" />
              <p className="text-caption t-muted mt-2">Health composite · last {trendValues.length} points</p>
            </Card>
          )}

          {/* Prepared-for masthead */}
          <Card className="p-5">
            <p className="text-label">Prepared For</p>
            <p className="text-body-sm t-primary mt-1.5">
              {user?.name || 'Executive Leadership Team'}
            </p>
          </Card>
        </div>
      </div>

      {/* Billing proof — same findings & field-mapping table as the dashboard
          (Higgsfield render 01), giving the exec briefing the dollar-level
          traceability behind the recovered figure above. */}
      <Card className="p-5 md:p-6">
        <FindingsReviewTable />
      </Card>

      {/* Dimensions */}
      {dimensionEntries.length > 0 && (
        <Card className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-headline-sm t-primary">Health Dimensions</h3>
            <button onClick={() => navigate('/apex')} className="text-caption text-accent hover:underline inline-flex items-center gap-1">
              Full breakdown <ArrowRight size={11} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {dimensionEntries.map(([key, dim]) => (
              <button
                key={key}
                onClick={() => navigate('/apex')}
                className="text-left p-4 rounded-md border border-[var(--border-card)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] transition-colors active:scale-[0.97]"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-headline-xl t-primary tabular-nums font-mono">{dim.score}</span>
                  {dim.trend === 'improving' || dim.trend === 'up' ? <TrendingUp size={12} style={{ color: 'var(--positive)' }} />
                    : dim.trend === 'declining' || dim.trend === 'down' ? <TrendingDown size={12} style={{ color: 'var(--neg)' }} />
                    : <Minus size={12} className="t-muted" />}
                </div>
                <p className="text-label mt-2">{key.replace(/[-_]/g, ' ')}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Targets */}
      {data.targets && data.targets.length > 0 && (
        <Card className="p-5 md:p-6">
          <h3 className="text-headline-sm t-primary mb-4">Active Targets</h3>
          <div className="space-y-3">
            {data.targets.map((t, i) => {
              const pct = t.targetValue ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100)) : 0;
              return (
                <div key={i} className="p-4 rounded-md bg-[var(--bg-secondary)]">
                  <div className="flex items-center justify-between">
                    <p className="text-body-sm t-primary">{t.targetName}</p>
                    <Badge variant={targetStatusColor(t.status)} className="text-caption">{t.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 rounded-sm bg-[var(--bg-primary)] overflow-hidden">
                      <div className="h-full rounded-sm bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-caption t-muted tabular-nums font-mono">{t.currentValue} / {t.targetValue}</span>
                  </div>
                  <p className="text-caption t-muted mt-1">{t.targetType}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

    </div>
  );
}
