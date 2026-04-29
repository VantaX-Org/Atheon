/**
 * /apex/brief — single-screen executive briefing optimised for mobile.
 *
 * Apex itself ships a 6-tab encyclopedia. This page is the 60-second view
 * an executive opens on their phone before a board meeting:
 *
 *   1. Health ring + delta vs prior period
 *   2. Top 3 critical/high risks with R-value-at-stake + Mitigate buttons
 *   3. Calibration accuracy + Provenance Merkle root
 *   4. Top peer-benchmark gap (one card)
 *   5. Briefing summary (LLM-generated executive narrative if present)
 *
 * No tabs, no filters. Vertical scroll. The page is the brief.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ui/score-ring";
import {
  Crown, AlertTriangle, Lock, Target, Globe, Zap, ArrowLeft, RefreshCw, Loader2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useSelectedCompanyId } from "@/stores/appStore";
import {
  recommendForRisk, recommendForDimension, catalystDeployUrl,
} from "@/lib/catalyst-recommendation";
import type {
  HealthScore, Briefing, Risk, HealthHistoryResponse, PeerBenchmarksResponse,
} from "@/lib/api";

type CalibrationSummary = Awaited<ReturnType<typeof api.catalysts.getCalibrationSummary>>;
type ProvenanceRoot = Awaited<ReturnType<typeof api.provenance.root>>;

const severityVariant = (s: string): 'danger' | 'warning' | 'info' | 'default' =>
  s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'default';

export function ApexBriefPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const companyId = useSelectedCompanyId();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [healthHistory, setHealthHistory] = useState<HealthHistoryResponse | null>(null);
  const [peerBenchmarks, setPeerBenchmarks] = useState<PeerBenchmarksResponse | null>(null);
  const [calibration, setCalibration] = useState<CalibrationSummary | null>(null);
  const [provRoot, setProvRoot] = useState<ProvenanceRoot | null>(null);

  async function load() {
    const co = companyId || undefined;
    try {
      const [h, b, r, hh, pb, cal, pr] = await Promise.allSettled([
        api.apex.health(undefined, undefined, co),
        api.apex.briefing(undefined, undefined, co),
        api.apex.risks(undefined, undefined, co),
        api.apex.healthHistory(undefined, undefined, co),
        api.peerBenchmarks.get(),
        api.catalysts.getCalibrationSummary(),
        api.provenance.root(),
      ]);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (b.status === 'fulfilled') setBriefing(b.value);
      if (r.status === 'fulfilled') setRisks(r.value.risks);
      if (hh.status === 'fulfilled') setHealthHistory(hh.value);
      if (pb.status === 'fulfilled') setPeerBenchmarks(pb.value);
      if (cal.status === 'fulfilled') setCalibration(cal.value);
      if (pr.status === 'fulfilled') setProvRoot(pr.value);
    } catch (err) {
      toast.error('Failed to load brief', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Initial load — once-on-mount; the refresh button drives subsequent reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [companyId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  const overall = health?.overall ?? 0;
  const delta = healthHistory?.delta ?? briefing?.healthDelta ?? null;
  const top3 = [...risks]
    .filter(r => r.severity === 'critical' || r.severity === 'high')
    .sort((a, b) => (b.impactValue || 0) - (a.impactValue || 0))
    .slice(0, 3);

  // Pick the single biggest peer gap for the brief.
  const biggestGap = peerBenchmarks?.benchmarks
    .filter(b => b.ownScore !== null && (b.percentileRank === 'below_median' || b.percentileRank === 'bottom_25'))
    .sort((a, b) => (a.ownScore! - a.p50Score) - (b.ownScore! - b.p50Score))[0];
  const gapRec = biggestGap ? recommendForDimension(biggestGap.dimension) : null;

  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto space-y-4" data-testid="apex-brief-page">
      {/* Compact mobile header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/apex')}
          className="flex items-center gap-1.5 text-sm t-secondary hover:t-primary"
          aria-label="Back to full Apex"
        >
          <ArrowLeft size={16} /> Apex
        </button>
        <button
          onClick={() => { setRefreshing(true); load(); }}
          disabled={refreshing}
          className="text-sm t-secondary hover:t-primary disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div>
        <h1 className="text-2xl font-bold t-primary">Briefing</h1>
        <p className="text-xs t-muted mt-1">{new Date().toLocaleString()}</p>
      </div>

      {/* 1. Health */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <ScoreRing score={overall} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="w-4 h-4 text-accent" />
              <h2 className="text-sm font-semibold t-primary">Business Health</h2>
            </div>
            <div className="text-3xl font-semibold t-primary leading-none">{Math.round(overall)}</div>
            {delta !== null && (
              <div className={`text-xs mt-1 ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 't-muted'}`}>
                {delta > 0 ? '+' : ''}{delta} pts vs prior
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 2. Top risks */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <h2 className="text-sm font-semibold t-primary">Top Risks</h2>
          <Badge variant="info" size="sm">{risks.length} active</Badge>
        </div>
        {top3.length === 0 ? (
          <div className="text-xs t-muted">No critical or high risks active.</div>
        ) : (
          <div className="space-y-3">
            {top3.map(risk => {
              const rec = recommendForRisk({ category: risk.category, title: risk.title });
              return (
                <div key={risk.id} className="rounded-lg p-3 bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm font-medium t-primary line-clamp-2">{risk.title}</div>
                    <Badge variant={severityVariant(risk.severity)} size="sm">{risk.severity}</Badge>
                  </div>
                  {risk.impactValue ? (
                    <div className="text-xs t-muted mb-2">
                      Impact: {risk.impactUnit === 'ZAR' || risk.impactUnit === 'currency'
                        ? `R${Math.round(risk.impactValue).toLocaleString()}`
                        : `${risk.impactValue.toLocaleString()} ${risk.impactUnit ?? ''}`}
                    </div>
                  ) : null}
                  {rec && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => navigate(catalystDeployUrl(rec))}
                      className="w-full"
                    >
                      <Zap size={11} className="mr-1" /> Mitigate via {rec.catalyst.replace(/ Catalyst$/, '')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 3. Calibration + Provenance combined */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">Trust signals</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider t-muted mb-1">Calibration</div>
            <div className="text-2xl font-semibold t-primary">
              {calibration?.accuracyPct?.toFixed(1) ?? '—'}<span className="text-sm t-muted">%</span>
            </div>
            <div className="text-[10px] t-muted mt-0.5">
              {calibration?.simulationsWithOutcomes ?? 0} outcomes
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider t-muted mb-1">Provenance</div>
            <div className="font-mono text-xs t-primary break-all">
              {provRoot?.root ? provRoot.root.slice(0, 16) + '…' : 'empty'}
            </div>
            <div className="text-[10px] t-muted mt-0.5 flex items-center gap-1">
              <Lock size={9} /> seq {provRoot?.seq ?? 0}
            </div>
          </div>
        </div>
      </Card>

      {/* 4. Biggest peer gap (if any) */}
      {biggestGap && gapRec && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold t-primary">Biggest peer gap</h2>
          </div>
          <div className="text-sm t-primary mb-1">
            <span className="font-medium capitalize">{biggestGap.dimension}</span> —
            you scored <span className="font-semibold">{biggestGap.ownScore}</span> vs peer median{' '}
            <span className="font-semibold">{biggestGap.p50Score}</span>
            <span className="t-muted"> (gap: {Math.round(biggestGap.p50Score - biggestGap.ownScore!)} pts)</span>.
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(catalystDeployUrl(gapRec))}
            className="w-full mt-2"
          >
            <Zap size={11} className="mr-1" /> Close gap via {gapRec.catalyst.replace(/ Catalyst$/, '')}
          </Button>
        </Card>
      )}

      {/* 5. Briefing summary */}
      {briefing?.summary && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold t-primary mb-2">Executive summary</h2>
          <p className="text-sm t-secondary leading-relaxed">{briefing.summary}</p>
        </Card>
      )}

      <div className="text-[10px] t-muted text-center pt-4">
        Full breakdown on /apex · Trust dashboard on /trust
      </div>
    </div>
  );
}

export default ApexBriefPage;
