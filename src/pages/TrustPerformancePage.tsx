/**
 * Trust & Performance — buyer-facing aggregation of the three world-first
 * capabilities into one 60-second demo asset.
 *
 *   1. Closed-loop calibration   — predicted vs actual, accuracy %, MAE
 *   2. Cryptographic provenance  — Merkle root + verify button + chain length
 *   3. Federated peer patterns   — cross-tenant DP-noised benchmarks
 *
 * Each capability has its own dedicated UI elsewhere (CatalystSimulatorCard,
 * ProvenanceVerifyPanel, PeerInsightsBadge). This page is the consolidated
 * view a salesperson can demo without three navigations — moat surfaced in
 * one screen.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  Target, Lock, Network, ShieldCheck, AlertTriangle, Loader2, RefreshCw,
} from 'lucide-react';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { ProvenanceVerifyResult, FederatedPattern } from '@/lib/api';
import { formatDays } from '@/lib/utils';
import { formatPreciseCurrency } from '@/lib/format-currency';
import { useTenantCurrency } from '@/stores/appStore';

type CalibrationSummary = Awaited<ReturnType<typeof api.catalysts.getCalibrationSummary>>;
type ProvenanceRoot = Awaited<ReturnType<typeof api.provenance.root>>;

export function TrustPerformancePage(): JSX.Element {
  const toast = useToast();
  // Tenant-level currency — calibration value fields are in tenant currency.
  const currency = useTenantCurrency();
  const formatZAR = (n: number | null | undefined) => formatPreciseCurrency(n, currency);
  const [calibration, setCalibration] = useState<CalibrationSummary | null>(null);
  const [root, setRoot] = useState<ProvenanceRoot | null>(null);
  const [verifyResult, setVerifyResult] = useState<ProvenanceVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [patterns, setPatterns] = useState<FederatedPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [cal, prov, peerRes] = await Promise.all([
        api.catalysts.getCalibrationSummary(),
        api.provenance.root(),
        api.peerPatterns.list('general').catch(() => ({ industry_bucket: 'general', patterns: [], total: 0 })),
      ]);
      setCalibration(cal);
      setRoot(prov);
      setPatterns(peerRes.patterns);
    } catch (err) {
      console.error('Failed to load trust dashboard', err);
      toast.error('Failed to load Trust & Performance', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }

  // Initial load — once-on-mount; the refresh button drives subsequent reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, []);

  async function refreshAll() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  async function runVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.provenance.verify();
      setVerifyResult(result);
      if (result.valid) {
        toast.success('Chain verified', `${result.total_entries} entries — every hash + signature valid`);
      } else {
        toast.error('Chain verification failed', `Tampering at seq ${result.first_invalid_seq}`);
      }
    } catch (err) {
      toast.error('Verification failed', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setVerifying(false);
    }
  }

  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        onRetry={() => void loadAll()}
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  const accuracyDisplay = calibration?.accuracyPct ?? 0;
  const chainEmpty = !root || root.seq === 0;
  const peerActive = patterns.filter(p => (p.n_contributors || 0) >= 5).length;

  // RAG dot colour for the hero status indicator — green when calibrated,
  // amber while warming up, accent during cold-start.
  const heroStatusVar =
    accuracyDisplay >= 80 ? '--rag-healthy' : accuracyDisplay >= 60 ? '--rag-watch' : '--accent';
  const heroStatusRgb =
    accuracyDisplay >= 80 ? '--rag-healthy-rgb' : accuracyDisplay >= 60 ? '--rag-watch-rgb' : '--accent-rgb';
  const heroStatusLabel = accuracyDisplay >= 80 ? 'Calibrated' : accuracyDisplay >= 60 ? 'Warming up' : 'Cold-start';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8" data-testid="trust-performance-page">
      <PageHeader
        live
        eyebrow="Trust · Model Performance"
        title="Trust &amp; Performance"
        dek="Three independent claims, three live verifications: predictions calibrated against real outcomes, AI decisions cryptographically chained and auditable, and cross-tenant benchmarks differentially-privatised before they ever leave the contributor."
        actions={
          <Button onClick={refreshAll} variant="ghost" size="sm" disabled={refreshing}>
            <RefreshCw size={14} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {/* ── Hero band: calibration accuracy as the headline trust metric ── */}
      <Card
        className="p-7"
        data-testid="trust-calibration"
        style={{ background: 'var(--accent-subtle)', borderColor: 'rgb(var(--accent-rgb) / 0.18)' }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-accent" />
              <span className="text-label">Closed-loop calibration</span>
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <span
                className="font-mono tabular-nums t-primary leading-none"
                style={{ fontSize: '3.5rem', fontWeight: 700 }}
                data-testid="trust-accuracy"
              >
                {accuracyDisplay.toFixed(1)}<span className="text-2xl t-muted">%</span>
              </span>
            </div>
            <div className="text-label mt-2">Prediction accuracy (predicted vs actual)</div>
            <p className="text-body-sm t-secondary mt-3 max-w-md">
              Mean residual deviation from 1.0 across {calibration?.simulationsWithOutcomes ?? 0} closed-loop observations.
            </p>
          </div>

          {/* Glowing RAG status indicator — the mockup's "HEALTHY" green orb */}
          <div className="flex items-center gap-4 shrink-0">
            <span
              aria-hidden
              className="inline-flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                background: `rgb(var(${heroStatusRgb}) / 0.14)`,
                boxShadow: `0 0 24px rgb(var(${heroStatusRgb}) / 0.45)`,
              }}
            >
              <span
                className="h-4 w-4 rounded-full animate-pulse"
                style={{ background: `var(${heroStatusVar})` }}
              />
            </span>
            <div>
              <div
                className="text-xl font-semibold leading-tight"
                style={{ color: `var(${heroStatusVar})` }}
              >
                {heroStatusLabel}
              </div>
              <div className="text-label mt-0.5">Calibration health</div>
            </div>
          </div>
        </div>

        {/* Supporting metric strip */}
        <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-6 md:grid-cols-4" style={{ borderColor: 'rgb(var(--accent-rgb) / 0.16)' }}>
          <div>
            <div className="text-label">Predictions</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums t-primary">{(calibration?.totalSimulations ?? 0).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-label">Outcomes recorded</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums t-primary">{(calibration?.simulationsWithOutcomes ?? 0).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-label">Calibrated subs (n≥5)</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums t-primary">{calibration?.calibratedSubCatalysts ?? 0}</div>
          </div>
          <div>
            <div className="text-label">Predicted value</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums t-primary">{formatZAR(calibration?.totalPredictedValueZar ?? 0)}</div>
          </div>
        </div>
      </Card>

      {/* ── Critical trust subsystems: provenance + peer benchmarks ── */}
      <section className="space-y-4">
        <h2 className="text-label">Critical trust subsystems</h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Cryptographic provenance */}
          <Card className="p-6 space-y-5" data-testid="trust-provenance">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--accent-subtle)' }}
              >
                <Lock className="w-4 h-4 text-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold t-primary">Provenance</h3>
                  <Badge variant="info" className="text-label shrink-0">Merkle + HMAC</Badge>
                </div>
                <div className="mt-3">
                  <div className="text-label mb-1">Current root</div>
                  <div className="font-mono text-xs t-primary break-all" data-testid="trust-root">
                    {root?.root ? root.root.slice(0, 32) + '…' : <span className="t-muted">empty chain</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: 'var(--border-card)' }}>
              <div>
                <div className="text-label">Sequence</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums t-primary">{(root?.seq ?? 0).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-label">Last appended</div>
                <div className="mt-1 text-sm t-primary">
                  {root?.created_at ? new Date(root.created_at).toLocaleDateString() : '—'}
                </div>
              </div>
            </div>

            <Button
              onClick={runVerify}
              variant="primary"
              size="sm"
              disabled={verifying || chainEmpty}
              data-testid="trust-verify-button"
              className="w-full"
            >
              {verifying ? <Loader2 size={14} className="animate-spin mr-2" /> : <ShieldCheck size={14} className="mr-2" />}
              Verify chain
            </Button>
            {verifyResult && (
              <div
                className="rounded-md p-3 text-xs flex items-start gap-2"
                style={{
                  background: verifyResult.valid ? 'rgb(var(--accent-rgb) / 0.08)' : 'rgb(var(--neg-rgb) / 0.08)',
                  border: `1px solid ${verifyResult.valid ? 'rgb(var(--accent-rgb) / 0.30)' : 'rgb(var(--neg-rgb) / 0.30)'}`,
                }}
              >
                {verifyResult.valid
                  ? <ShieldCheck className="w-4 h-4 text-accent flex-shrink-0 mt-[1px]" />
                  : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-[1px]" style={{ color: 'var(--neg)' }} />}
                <div className="t-secondary">
                  {verifyResult.valid
                    ? `${verifyResult.total_entries} entries — all hashes + signatures valid`
                    : `Tampering at seq ${verifyResult.first_invalid_seq} of ${verifyResult.total_entries}`}
                </div>
              </div>
            )}
          </Card>

          {/* Federated peer patterns */}
          <Card className="p-6 space-y-5" data-testid="trust-federation">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--accent-subtle)' }}
              >
                <Network className="w-4 h-4 text-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold t-primary">Peer benchmarks</h3>
                  <Badge variant="info" className="text-label shrink-0">DP ε = 1.0</Badge>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold font-mono tabular-nums t-primary">{peerActive}</span>
                  <span className="text-sm t-muted">active patterns</span>
                </div>
                <p className="text-xs t-muted mt-2">
                  Each pattern aggregates ≥5 contributing tenants in the same industry. Laplace noise
                  added before publication; raw observations never leave the source tenant.
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-2.5" style={{ borderColor: 'var(--border-card)' }}>
              {patterns.length === 0 ? (
                <div className="text-xs t-muted">
                  No published patterns yet — federation activates after the first ε-private
                  aggregate clears the k=5 contributor floor.
                </div>
              ) : (
                patterns.slice(0, 4).map(p => (
                  <div key={p.finding_code} className="flex items-center justify-between text-xs">
                    <div className="t-primary truncate font-mono">{p.finding_code}</div>
                    <div className="t-muted ml-2 whitespace-nowrap font-mono">
                      {p.n_contributors}× · {formatDays(p.avg_resolved_days)} · {Math.round(p.avg_recovery_pct)}%
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* ── Why this matters strip ── */}
      <section className="space-y-4">
        <h2 className="text-label">Why this matters</h2>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Card className="p-6">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'var(--accent-subtle)' }}
            >
              <Target className="w-4 h-4 text-accent" />
            </span>
            <div className="text-base font-semibold t-primary mt-4 mb-1.5">Predictions are checked</div>
            <div className="text-body-sm t-muted">
              Every catalyst run records what we predicted. Outcomes get fed back. The
              calibration factor self-corrects — if we're 12% high, the next prediction shifts
              12% lower automatically.
            </div>
          </Card>
          <Card className="p-6">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'var(--accent-subtle)' }}
            >
              <Lock className="w-4 h-4 text-accent" />
            </span>
            <div className="text-base font-semibold t-primary mt-4 mb-1.5">Decisions are signed</div>
            <div className="text-body-sm t-muted">
              Every AI decision is appended to a hash-linked, HMAC-signed chain. Tampering with
              any historical entry breaks the Merkle root for every entry that follows. An
              auditor can re-derive the chain in seconds.
            </div>
          </Card>
          <Card className="p-6">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'var(--accent-subtle)' }}
            >
              <Network className="w-4 h-4 text-accent" />
            </span>
            <div className="text-base font-semibold t-primary mt-4 mb-1.5">Benchmarks are private</div>
            <div className="text-body-sm t-muted">
              Cross-tenant patterns publish only when ≥5 tenants contribute to the same
              industry bucket, and only with Laplace noise (ε = 1.0). Your raw operational data
              never leaves your tenant.
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

export default TrustPerformancePage;
