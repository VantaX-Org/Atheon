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
import { useAppStore } from '@/stores/appStore';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { PageHeader } from '@/components/ui/page-header';
import { ScoreRing } from '@/components/ui/score-ring';
import { Sparkline } from '@/components/ui/sparkline';
import { SharedSavingsStrip } from '@/components/SharedSavingsStrip';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import type { ExecutiveSummaryResponse } from '@/lib/api';
import {
  AlertCircle, TrendingUp,
  TrendingDown, Minus, RefreshCw, ArrowRight,
} from 'lucide-react';

const formatCurrency = (value: number): string => {
  if (!value) return '$0';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

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

  return (
    <div className="space-y-6 animate-fadeIn">
      <SharedSavingsStrip />

      <PageHeader
        eyebrow="Executive · Briefing"
        title="Executive summary"
        dek={`One-page briefing for ${user?.name?.split(' ')[0] || 'executives'} — aggregated from Apex, ROI, diagnostics & signals`}
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

      {/* Wave H-3: The page is named "Executive summary" — the Atheon
          Score IS its anchor metric. The previous 3-equal-card grid
          (Atheon / Health / Journey) gave every score the same visual
          rank, which dilutes the executive read. Promoted Atheon Score
          to a .card-hero anchor with the score number set in .text-hero
          (44px tabular-num) next to the ring; Health Score + Journey
          demoted to a supporting ledger column on the right. */}
      <div className="card-hero p-7 md:p-8" data-testid="exec-summary-hero">
        <p className="hero-eyebrow flex items-center gap-2 mb-4">
          <TrendingUp size={11} aria-hidden="true" />
          Atheon Score · Composite
        </p>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0">
            <ScoreRing score={data.atheonScore} size="lg" />
            <div className="min-w-0">
              <p className="text-hero t-primary leading-none">{data.atheonScore ?? '—'}</p>
              <p className="text-body-sm t-muted mt-2">Composite across 5 health pillars</p>
            </div>
          </div>
          <div className="md:text-right shrink-0 grid grid-cols-2 md:grid-cols-1 gap-4 md:gap-3">
            <div className="md:flex md:items-center md:justify-end md:gap-3">
              <div className="md:order-2 md:text-right">
                <p className="text-caption uppercase tracking-wider t-muted">Health</p>
                <p className="text-headline-md font-semibold t-primary tabular-nums font-mono mt-0.5">{data.healthScore ?? '—'}</p>
                {trendValues.length > 1 && (
                  <p className="text-caption t-muted mt-0.5">trend · last {trendValues.length} pts</p>
                )}
              </div>
              {trendValues.length > 1 && (
                <div className="md:order-1 mt-1.5 md:mt-0">
                  <Sparkline data={trendValues} width={96} height={24} />
                </div>
              )}
            </div>
            <div>
              <p className="text-caption uppercase tracking-wider t-muted">Journey</p>
              {data.journey?.baselineHealthScore !== null && data.journey?.baselineHealthScore !== undefined ? (
                <>
                  <div className="flex items-baseline md:justify-end gap-1.5 mt-0.5">
                    <span className="text-headline-md font-semibold t-primary tabular-nums font-mono">
                      {improvement !== null && improvement !== undefined && improvement > 0 ? '+' : ''}{improvement ?? 0}
                    </span>
                    {improvementIcon}
                  </div>
                  <p className="text-caption t-muted mt-0.5">vs baseline {data.journey.baselineHealthScore}</p>
                </>
              ) : (
                <p className="text-body-sm t-muted mt-0.5">No baseline captured</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Financial + Diagnostic KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-label">Value Recovered</p>
          <p className="text-xl font-bold t-primary">{formatCurrency(data.roi?.recovered || 0)}</p>
          <p className="text-caption t-muted mt-1">
            {data.roi?.multiple ? `${data.roi.multiple.toFixed(1)}× ROI` : 'Awaiting first catalyst'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Active RCAs</p>
          <p className="text-xl font-bold t-primary">{data.diagnostics?.activeRcas ?? 0}</p>
          <p className="text-caption t-muted mt-1">Root-cause investigations</p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Pending Rx</p>
          <p className="text-xl font-bold t-primary">{data.diagnostics?.pendingPrescriptions ?? 0}</p>
          <p className="text-caption t-muted mt-1">Prescriptions awaiting action</p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Signals (7d)</p>
          <p className="text-xl font-bold t-primary">{data.signals?.newThisWeek ?? 0}</p>
          <p className="text-caption t-muted mt-1">External radar signals</p>
        </Card>
      </div>

      {/* Dimensions */}
      {dimensionEntries.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold t-primary">Health Dimensions</h3>
            <button onClick={() => navigate('/apex')} className="text-caption text-accent hover:underline inline-flex items-center gap-1">
              Full breakdown <ArrowRight size={11} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {dimensionEntries.map(([key, dim]) => (
              <button
                key={key}
                onClick={() => navigate('/apex')}
                className="text-left p-3 rounded-md border border-[var(--border-card)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] transition-colors active:scale-[0.97]"
              >
                <p className="text-label">{key.replace(/[-_]/g, ' ')}</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold t-primary">{dim.score}</span>
                  {dim.trend === 'improving' || dim.trend === 'up' ? <TrendingUp size={12} style={{ color: 'var(--positive)' }} />
                    : dim.trend === 'declining' || dim.trend === 'down' ? <TrendingDown size={12} style={{ color: 'var(--neg)' }} />
                    : <Minus size={12} className="t-muted" />}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Top Risks */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold t-primary">Top Risks</h3>
          <button onClick={() => navigate('/apex')} className="text-caption text-accent hover:underline inline-flex items-center gap-1">
            All risks <ArrowRight size={11} />
          </button>
        </div>
        {data.topRisks && data.topRisks.length > 0 ? (
          <div className="space-y-2">
            {data.topRisks.map((risk, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-[var(--bg-secondary)]">
                <AlertCircle size={14} style={{
                  color: risk.severity === 'critical' ? 'var(--neg)' :
                    risk.severity === 'high' ? 'var(--neg)' : 'var(--warning)',
                }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium t-primary truncate">{risk.title}</p>
                    <StatusPill status={risk.severity} size="sm" />
                  </div>
                  {!!risk.impactValue && (
                    <p className="text-caption t-muted mt-0.5">Est. impact {formatCurrency(risk.impactValue)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs t-muted py-2">No active high-priority risks. Nice work.</p>
        )}
      </Card>

      {/* Targets */}
      {data.targets && data.targets.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold t-primary mb-3">Active Targets</h3>
          <div className="space-y-2">
            {data.targets.map((t, i) => {
              const pct = t.targetValue ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100)) : 0;
              return (
                <div key={i} className="p-3 rounded-md bg-[var(--bg-secondary)]">
                  <div className="flex items-center justify-between">
                    <p className="text-sm t-primary">{t.targetName}</p>
                    <Badge variant={targetStatusColor(t.status)} className="text-caption">{t.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-sm bg-[var(--bg-primary)] overflow-hidden">
                      <div className="h-full rounded-sm bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-caption t-muted tabular-nums">{t.currentValue} / {t.targetValue}</span>
                  </div>
                  <p className="text-caption t-muted mt-0.5">{t.targetType}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

    </div>
  );
}
