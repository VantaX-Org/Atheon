import { useState, useEffect, useId, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { ScoreRing } from "@/components/ui/score-ring";
import { FlipCard } from "@/components/ui/flip-card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { cleanLlmText } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { HealthScore, Risk, Metric, AnomalyItem, ClusterItem, ActionItem, ControlPlaneHealth, HealthDimensionTraceResponse, DashboardIntelligenceResponse, RadarContextResponse, DiagnosticSummaryResponse, ROITrackingResponse, BaselineComparisonResponse } from "@/lib/api";
import { AtheonScoreRing } from "@/components/ui/atheon-score-ring";
import { TraceabilityModal } from "@/components/TraceabilityModal";
import {
  TrendingUp, TrendingDown, Minus,
  ChevronRight, AlertTriangle, RefreshCw, Eye, Lightbulb, ArrowRight,
  CheckCircle2, XCircle, Gauge, Shield, Radar, Stethoscope, Coins,
} from "lucide-react";
import { OnboardingChecklist } from "@/components/common/OnboardingChecklist";
import { SectionFreshness } from "@/components/common/FreshnessIndicator";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

const ACCENT = "#4A6B5A";
const ACCENT_B = "#5d8a6f";
const BRONZE = "#c9a059";
const SKY = "#7AACB5";
const CHART_LIGHT = "#b8d4c4";

const trendIcon = (trend: string) => {
  if (trend === "up" || trend === "improving") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === "down" || trend === "declining") return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

function DashCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "var(--bg-card-solid)",
        border: "1px solid var(--border-card)",
        boxShadow: "0 2px 12px rgba(100, 120, 180, 0.07), 0 0 0 1px rgba(255,255,255,0.5)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TintedCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(74, 107, 90, 0.06), rgba(93, 138, 111, 0.03))",
        border: "1px solid rgba(74, 107, 90, 0.10)",
        boxShadow: "0 2px 12px rgba(74, 107, 90, 0.05)",
      }}
    >
      {children}
    </div>
  );
}

export function Dashboard() {
  const industry = useAppStore((s) => s.industry);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [cpHealth, setCpHealth] = useState<ControlPlaneHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "health" | "risks">("overview");
  // UX-05: Silent auto-refresh every 60s (no user-facing toggle)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [refreshFlash, setRefreshFlash] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pieId = useId();

  // Dashboard Intelligence state
  const [dashIntel, setDashIntel] = useState<DashboardIntelligenceResponse | null>(null);
  const [dashIntelLoading, setDashIntelLoading] = useState(false);

  // New engine summary state
  const [radarCtx, setRadarCtx] = useState<RadarContextResponse | null>(null);
  const [diagSummary, setDiagSummary] = useState<DiagnosticSummaryResponse | null>(null);
  const [roiData, setRoiData] = useState<ROITrackingResponse | null>(null);

  // §11.2 Baseline journey state
  const [baselineComparison, setBaselineComparison] = useState<BaselineComparisonResponse | null>(null);

  // Flip card state for dashboard cards
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
  const toggleFlip = (cardId: string) => setFlippedCards(prev => ({ ...prev, [cardId]: !prev[cardId] }));

  const loadDashboardIntelligence = async () => {
    setDashIntelLoading(true);
    try {
      const result = await api.apex.dashboardIntelligence();
      setDashIntel(result);
    } catch (err) { console.error('Failed to load dashboard intelligence:', err); }
    setDashIntelLoading(false);
  };

  // Traceability modal state
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [traceData, setTraceData] = useState<HealthDimensionTraceResponse | null>(null);
  const [, setLoadingTrace] = useState(false);

  const handleOpenDimensionTrace = async (dimension: string) => {
    setLoadingTrace(true);
    try {
      const data = await api.apex.healthDimension(dimension);
      if (!data || data.score === null) {
        alert('No traceability data available yet. Run a catalyst in this domain to generate health data.');
        return;
      }
      setTraceData(data);
      setShowTraceModal(true);
    } catch (err) {
      console.error('Failed to load dimension traceability', err);
      alert('Failed to load traceability data. Please ensure catalysts have been run for this domain.');
    } finally {
      setLoadingTrace(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const ind = industry !== 'general' ? industry : undefined;
      const [h, r, m, a, c, act, cp] = await Promise.allSettled([
        api.apex.health(undefined, ind),
        api.apex.risks(undefined, ind),
        api.pulse.metrics(undefined, ind),
        api.pulse.anomalies(undefined, ind),
        api.catalysts.clusters(undefined, ind),
        api.catalysts.actions(undefined, undefined, ind),
        api.controlplane.health(undefined, ind),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (r.status === "fulfilled") setRisks(r.value.risks);
      if (m.status === "fulfilled") setMetrics(m.value.metrics);
      if (a.status === "fulfilled") setAnomalies(a.value.anomalies);
      if (c.status === "fulfilled") setClusters(c.value.clusters);
      if (act.status === "fulfilled") setActions(act.value.actions);
      if (cp.status === "fulfilled") setCpHealth(cp.value);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    }
    setLoading(false);
    setLastRefreshed(new Date());
  }, [industry]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load new engine summaries + baseline comparison
  useEffect(() => {
    Promise.allSettled([
      api.radar.getContext(),
      api.diagnostics.getSummary(),
      api.roi.get(),
      api.baseline.comparison(),
    ]).then(([rc, ds, roi, bc]) => {
      if (rc.status === 'fulfilled') setRadarCtx(rc.value);
      if (ds.status === 'fulfilled') setDiagSummary(ds.value);
      if (roi.status === 'fulfilled') setRoiData(roi.value);
      if (bc.status === 'fulfilled') setBaselineComparison(bc.value);
    });
  }, []);

  // UX-05: Silent auto-refresh every 60s
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      loadData().then(() => {
        setRefreshFlash(true);
        setTimeout(() => setRefreshFlash(false), 2000);
      });
    }, 60000);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [loadData]);

  const overallScore = health?.overall ?? 0;
  const dimEntries = health?.dimensions ? Object.values(health.dimensions) : [];
  const upCount = dimEntries.filter((d) => d.trend === "up" || d.trend === "improving").length;
  const downCount = dimEntries.filter((d) => d.trend === "down" || d.trend === "declining").length;
  const healthTrend = upCount > downCount ? "up" : downCount > upCount ? "down" : "stable";
  const avgDelta = dimEntries.length > 0 ? dimEntries.reduce((s, d) => s + (d.delta ?? 0), 0) / dimEntries.length : 0;

  const dimensions = health?.dimensions
    ? Object.entries(health.dimensions).map(([key, val]) => ({
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        score: val.score,
        trend: val.trend as string,
        change: val.delta ?? 0,
      }))
    : [];

  const activeCatalysts = clusters.filter((c) => c.status === "active").length;
  const totalTasks = clusters.reduce((sum, c) => sum + (c.tasksInProgress || 0), 0);

  // Derive the primary and secondary metric from actual catalyst-generated data
  const primaryMetric = metrics.length > 0 ? metrics[0] : null;
  const secondaryMetric = metrics.length > 1 ? metrics[1] : null;
  const primaryMetricLabel = primaryMetric ? primaryMetric.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Health Score';
  const secondaryMetricLabel = secondaryMetric ? secondaryMetric.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;

  // Metrics over time — no synthesized data; left empty until real time-series data is available
  const metricsOverTime: Record<string, string | number>[] = [];

  const piePalette = [ACCENT, ACCENT_B, SKY, BRONZE, CHART_LIGHT];
  const pieData = dimensions.slice(0, 5).map((dim, i) => ({
    name: dim.name,
    value: dim.score,
    fill: piePalette[i % piePalette.length],
  }));

  // Month-over-month change data — no synthesized data; left empty until real time-series data is available
  const momData: { month: string; change: number }[] = [];

  // U12: Progressive skeleton loading instead of spinner
  if (loading && !health) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* §9.2 Onboarding Checklist */}
      <OnboardingChecklist />

      {/* HEADER — matches Apex/Pulse layout */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-bold t-primary">Atheon Dashboard</h1>
            <SectionFreshness section="Health" />
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] t-muted transition-colors duration-500 ${refreshFlash ? 'text-emerald-500' : ''}`}>
              Updated: {lastRefreshed.toLocaleTimeString()}
            </span>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center t-muted hover:t-primary transition-all"
              style={{ background: "var(--bg-secondary)" }}
              title={`Last refreshed: ${lastRefreshed.toLocaleTimeString()}`}
              onClick={() => loadData().then(() => { setRefreshFlash(true); setTimeout(() => setRefreshFlash(false), 2000); })}
              aria-label="Refresh dashboard data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
          {(["overview", "health", "risks"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize"
              style={
                activeTab === tab
                  ? { background: "var(--bg-card-solid)", color: "var(--text-primary)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }
                  : { color: "var(--text-muted)" }
              }
            >
              {tab === "health" ? "Health Trend" : tab}
            </button>
          ))}
        </div>
        <button
          onClick={loadDashboardIntelligence}
          disabled={dashIntelLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-all disabled:opacity-50 ml-auto"
          title="Generate AI-powered dashboard intelligence"
        >
          <Lightbulb size={12} className={dashIntelLoading ? 'animate-pulse' : ''} />
          {dashIntelLoading ? 'Analyzing...' : 'AI Insights'}
        </button>
      </div>

      {/* Dashboard Intelligence Panel */}
      {dashIntel && (
        <DashCard className="!border-purple-500/20 !bg-purple-500/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-purple-400" />
              <h3 className="text-sm font-semibold t-primary">Atheon Intelligence — Dashboard Summary</h3>
            </div>
            <span className="text-[10px] t-muted">{dashIntel.poweredBy}</span>
          </div>
          <p className="text-sm t-secondary mb-3 whitespace-pre-line">{cleanLlmText(dashIntel.summary)}</p>
          {dashIntel.keyMetrics.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium t-primary mb-1.5">Key Metrics</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {dashIntel.keyMetrics.map((m, i) => (
                  <div key={i} className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <p className="text-[10px] t-muted">{m.name}</p>
                    <p className="text-sm font-bold t-primary">{typeof m.value === 'number' ? m.value.toFixed(1) : m.value}</p>
                    <div className="flex items-center gap-1">
                      {trendIcon(m.trend)}
                      <span className="text-[10px] t-muted">{m.status === 'red' ? 'Critical' : m.status === 'amber' ? 'Warning' : 'Healthy'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dashIntel.topRisks.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium t-primary mb-1.5">Top Risks</p>
              <div className="space-y-1">
                {dashIntel.topRisks.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <AlertTriangle size={10} className={r.severity === 'critical' ? 'text-red-400' : r.severity === 'high' ? 'text-amber-400' : 'text-gray-400'} />
                    <span className="t-primary font-medium">{r.title}</span>
                    <Badge variant={r.severity === 'critical' ? 'danger' : r.severity === 'high' ? 'warning' : 'default'} size="sm">{r.severity}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dashIntel.recommendedActions.length > 0 && (
            <div>
              <p className="text-xs font-medium t-primary mb-1.5">Recommended Actions</p>
              <ul className="space-y-1">
                {dashIntel.recommendedActions.map((a, i) => (
                  <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
                    <ArrowRight size={10} className="text-purple-400 mt-0.5 flex-shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DashCard>
      )}

      {/* §11.7 Atheon Score + §11.2 Journey Card */}
      {activeTab === 'overview' && (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <DashCard className="lg:col-span-1">
          <h3 className="text-sm font-semibold t-primary mb-3 flex items-center gap-1.5">
            <Gauge size={14} className="text-accent" /> Atheon Score
          </h3>
          <AtheonScoreRing />
        </DashCard>
        <DashCard className="lg:col-span-2">
          <h3 className="text-sm font-semibold t-primary mb-3 flex items-center gap-1.5">
            <TrendingUp size={14} className="text-accent" /> Your Atheon Journey
          </h3>
          {baselineComparison?.dayZero && baselineComparison?.improvement ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                  <p className="text-[10px] t-muted uppercase">Baseline Health</p>
                  <p className="text-lg font-bold t-primary">{baselineComparison.dayZero.healthScore}</p>
                  <p className="text-[9px] t-muted">{new Date(baselineComparison.dayZero.capturedAt).toLocaleDateString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                  <p className="text-[10px] t-muted uppercase">Current Health</p>
                  <p className="text-lg font-bold t-primary">{baselineComparison.current?.healthScore ?? '--'}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                  <p className="text-[10px] t-muted uppercase">Improvement</p>
                  <p className={`text-lg font-bold ${baselineComparison.improvement.healthScore >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {baselineComparison.improvement.healthScore >= 0 ? '+' : ''}{baselineComparison.improvement.healthScore}
                  </p>
                </div>
              </div>
              <p className="text-xs t-secondary">{baselineComparison.narrative}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <TrendingUp className="w-8 h-8 t-muted mb-2 opacity-30" />
              <p className="text-xs t-muted">No baseline captured yet.</p>
              <p className="text-[10px] t-muted">Run your first catalyst to capture a day-zero snapshot.</p>
            </div>
          )}
        </DashCard>
      </div>

      {/* Hero: Health Score as central KPI */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <FlipCard
          className="lg:col-span-1"
          isFlipped={!!flippedCards['dash-health']}
          onFlip={() => toggleFlip('dash-health')}
          front={
            <TintedCard className="h-full flex flex-col items-center justify-center py-6">
              <ScoreRing score={overallScore} size="xl" label="Business Health" />
              <div className="flex items-center gap-2 mt-4">
                {trendIcon(healthTrend)}
                <span className={`text-sm ${avgDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(1)} pts
                </span>
              </div>
              <div className="w-28 h-8 mt-2">
                <Sparkline data={dimEntries.map((d) => d.score)} width={112} height={32} color={ACCENT} />
              </div>
              <p className="text-[10px] t-muted mt-3">Click to see breakdown</p>
            </TintedCard>
          }
          back={
            <TintedCard className="h-full">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold t-primary flex items-center gap-1.5"><Gauge size={14} className="text-accent" /> Health Breakdown</h4>
                <span className="text-xs font-bold t-primary">{overallScore}/100</span>
              </div>
              <div className="space-y-2.5">
                {dimensions.map((dim) => (
                  <div key={dim.key} className="flex items-center gap-2">
                    <span className="text-xs t-secondary w-28 truncate">{dim.name}</span>
                    <div className="flex-1">
                      <Progress value={dim.score} color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'} size="sm" />
                    </div>
                    <span className="text-xs font-bold t-primary w-8 text-right">{dim.score}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenDimensionTrace(dim.key); }}
                      className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5 transition-colors"
                      title={`Trace ${dim.name}`}
                    >
                      <Eye size={10} />
                    </button>
                  </div>
                ))}
                {dimensions.length === 0 && <p className="text-xs t-muted text-center py-4">No dimension data yet</p>}
              </div>
              <p className="text-[10px] t-muted mt-3 text-center">Click to flip back</p>
            </TintedCard>
          }
        />

        <DashCard className="lg:col-span-2">
          <h3 className="text-lg font-semibold t-primary mb-4">Business Dimensions</h3>
          {dimensions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Gauge className="w-10 h-10 t-muted mb-3 opacity-30" />
              <p className="text-sm t-muted">No dimensions available yet.</p>
              <p className="text-xs t-muted mt-1">Run a catalyst to start generating health data.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dimensions.map((dim, i) => (
                <div key={dim.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="sm:w-36 flex-shrink-0 flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: piePalette[i % piePalette.length] }} />
                    <span className="text-sm t-secondary truncate">{dim.name}</span>
                  </div>
                  <div className="flex-1">
                    <Progress value={dim.score} color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'} size="md" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold t-primary w-8 text-right">{dim.score}</span>
                    <div className="flex items-center gap-1 w-16">
                      {trendIcon(dim.trend)}
                      <span className={`text-xs ${dim.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {dim.change > 0 ? '+' : ''}{dim.change}
                      </span>
                    </div>
                    <button
                      onClick={() => handleOpenDimensionTrace(dim.key)}
                      className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5 transition-colors"
                      title={`Trace ${dim.name}`}
                    >
                      <Eye size={10} /> Trace
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashCard>
      </div>

      {/* Status Breakdown Cards (Flippable) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <FlipCard
          isFlipped={!!flippedCards['dash-dims']}
          onFlip={() => toggleFlip('dash-dims')}
          front={
            <DashCard className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Dimensions</span>
                <Gauge size={14} className="text-accent" />
              </div>
              <p className="text-2xl font-bold t-primary">{dimensions.length}</p>
              <p className="text-[10px] t-muted mt-1">monitored areas</p>
            </DashCard>
          }
          back={
            <DashCard className="h-full">
              <span className="text-xs font-semibold t-primary mb-2 block">All Dimensions</span>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {dimensions.map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-[10px]">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className={`font-medium ${d.score >= 80 ? 'text-emerald-400' : d.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{d.score}</span>
                  </div>
                ))}
                {dimensions.length === 0 && <p className="text-[9px] t-muted text-center py-2">No dimensions yet</p>}
              </div>
            </DashCard>
          }
        />
        <FlipCard
          isFlipped={!!flippedCards['dash-healthy']}
          onFlip={() => toggleFlip('dash-healthy')}
          front={
            <DashCard className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Healthy</span>
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-emerald-400">{dimensions.filter(d => d.score >= 80).length}</p>
              <p className="text-[10px] t-muted mt-1">above threshold</p>
            </DashCard>
          }
          back={
            <DashCard className="h-full">
              <span className="text-xs font-semibold text-emerald-400 mb-2 block">Healthy Dimensions</span>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {dimensions.filter(d => d.score >= 80).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-[10px]">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium text-emerald-400">{d.score}</span>
                  </div>
                ))}
                {dimensions.filter(d => d.score >= 80).length === 0 && <p className="text-[9px] t-muted text-center py-2">No healthy dimensions</p>}
              </div>
            </DashCard>
          }
        />
        <FlipCard
          isFlipped={!!flippedCards['dash-atrisk']}
          onFlip={() => toggleFlip('dash-atrisk')}
          front={
            <DashCard className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">At Risk</span>
                <AlertTriangle size={14} className="text-amber-400" />
              </div>
              <p className="text-2xl font-bold text-amber-400">{dimensions.filter(d => d.score >= 60 && d.score < 80).length}</p>
              <p className="text-[10px] t-muted mt-1">needs attention</p>
            </DashCard>
          }
          back={
            <DashCard className="h-full">
              <span className="text-xs font-semibold text-amber-400 mb-2 block">At Risk Dimensions</span>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {dimensions.filter(d => d.score >= 60 && d.score < 80).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-[10px]">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium text-amber-400">{d.score}</span>
                  </div>
                ))}
                {dimensions.filter(d => d.score >= 60 && d.score < 80).length === 0 && <p className="text-[9px] t-muted text-center py-2">No at-risk dimensions</p>}
              </div>
            </DashCard>
          }
        />
        <FlipCard
          isFlipped={!!flippedCards['dash-critical']}
          onFlip={() => toggleFlip('dash-critical')}
          front={
            <DashCard className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Critical</span>
                <XCircle size={14} className="text-red-400" />
              </div>
              <p className="text-2xl font-bold text-red-400">{dimensions.filter(d => d.score < 60).length}</p>
              <p className="text-[10px] t-muted mt-1">requires action</p>
            </DashCard>
          }
          back={
            <DashCard className="h-full">
              <span className="text-xs font-semibold text-red-400 mb-2 block">Critical Dimensions</span>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {dimensions.filter(d => d.score < 60).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-[10px]">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium text-red-400">{d.score}</span>
                  </div>
                ))}
                {dimensions.filter(d => d.score < 60).length === 0 && <p className="text-[9px] t-muted text-center py-2">No critical dimensions</p>}
              </div>
            </DashCard>
          }
        />
      </div>

      {/* New Engine Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Strategic Context (Apex Radar) */}
        <Link to="/apex" className="block">
          <DashCard className="hover:border-accent/30 transition-all cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Radar size={16} className="text-accent" />
                <h4 className="text-sm font-semibold t-primary">Strategic Context</h4>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {radarCtx ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xl font-bold t-primary">{radarCtx.summary.totalSignals}</p>
                  <p className="text-[10px] t-muted">Signals</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-red-400">{radarCtx.summary.criticalImpacts}</p>
                  <p className="text-[10px] t-muted">Critical Impacts</p>
                </div>
                <div>
                  <p className="text-xl font-bold">{radarCtx.summary.overallSentiment === 'positive' ? '🟢' : radarCtx.summary.overallSentiment === 'negative' ? '🔴' : '🟡'}</p>
                  <p className="text-[10px] t-muted capitalize">{radarCtx.summary.overallSentiment}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs t-muted">No external signals tracked yet. Visit Apex → Strategic Context.</p>
            )}
          </DashCard>
        </Link>

        {/* Active Diagnostics (Pulse Diagnostics) */}
        <Link to="/pulse" className="block">
          <DashCard className="hover:border-accent/30 transition-all cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Stethoscope size={16} className="text-purple-400" />
                <h4 className="text-sm font-semibold t-primary">Active Diagnostics</h4>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {diagSummary ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xl font-bold t-primary">{diagSummary.totalAnalyses}</p>
                  <p className="text-[10px] t-muted">Analyses</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-red-400">{diagSummary.criticalFindings}</p>
                  <p className="text-[10px] t-muted">Critical Findings</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-amber-400">{diagSummary.undiagnosedMetrics}</p>
                  <p className="text-[10px] t-muted">Undiagnosed</p>
                </div>
              </div>
            ) : (
              <p className="text-xs t-muted">No diagnostics run yet. Visit Pulse → Diagnostics.</p>
            )}
          </DashCard>
        </Link>
      </div>


      {/* V2 Engine Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Strategic Context Card */}
        <Link to="/apex" className="block">
          <DashCard className="h-full hover:border-accent/30 transition-all cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Radar size={16} className="text-accent" />
                <span className="text-sm font-semibold t-primary">Strategic Context</span>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {radarCtx ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold t-primary">{radarCtx.signals?.length ?? 0}</span>
                  <span className="text-xs t-muted">active signals</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={radarCtx.context?.sentiment === 'negative' ? 'danger' : radarCtx.context?.sentiment === 'positive' ? 'success' : 'warning'} size="sm">
                    {radarCtx.context?.sentiment ?? 'neutral'}
                  </Badge>
                  <span className="text-[10px] t-muted">market sentiment</span>
                </div>
                {radarCtx.context?.confidence != null && (
                  <Progress value={radarCtx.context.confidence} color={radarCtx.context.confidence >= 70 ? 'emerald' : 'amber'} size="sm" />
                )}
              </div>
            ) : (
              <p className="text-xs t-muted">No signals detected yet</p>
            )}
          </DashCard>
        </Link>

        {/* Active Diagnostics Card */}
        <Link to="/pulse" className="block">
          <DashCard className="h-full hover:border-accent/30 transition-all cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Stethoscope size={16} className="text-purple-400" />
                <span className="text-sm font-semibold t-primary">Active Diagnostics</span>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {diagSummary ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold t-primary">{diagSummary.totalAnalyses ?? 0}</span>
                  <span className="text-xs t-muted">analyses completed</span>
                </div>
                <div className="flex items-center gap-3">
                  {diagSummary.criticalFindings > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-xs text-red-400">{diagSummary.criticalFindings} critical</span>
                    </div>
                  )}
                  {diagSummary.pendingAnalyses > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-amber-400" />
                      <span className="text-xs text-amber-400">{diagSummary.pendingAnalyses} pending</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs t-muted">No diagnostics yet</p>
            )}
          </DashCard>
        </Link>

        {/* ROI Card */}
        <Link to="/catalysts" className="block">
          <DashCard className="h-full hover:border-accent/30 transition-all cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Coins size={16} className="text-emerald-400" />
                <span className="text-sm font-semibold t-primary">ROI Tracking</span>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {roiData?.roiMultiple != null ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-emerald-400">
                    {roiData.roiMultiple}x
                  </span>
                  <span className="text-xs t-muted">return multiple</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] t-muted">Recovered</p>
                    <p className="text-xs font-medium text-emerald-400">
                      R{((roiData.totalDiscrepancyValueRecovered ?? 0) / 1000000).toFixed(1)}M
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] t-muted">Prevented</p>
                    <p className="text-xs font-medium text-accent">
                      R{((roiData.totalPreventedLosses ?? 0) / 1000000).toFixed(1)}M
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs t-muted">No ROI data yet</p>
            )}
          </DashCard>
        </Link>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-5">
          <DashCard>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
              <p className="text-sm font-semibold t-primary">Metrics Over Time</p>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: ACCENT }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} /> {primaryMetricLabel}
                </span>
                {secondaryMetricLabel && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium t-muted">
                    <span className="w-2 h-2 rounded-full" style={{ background: CHART_LIGHT }} /> {secondaryMetricLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricsOverTime}>
                  <defs>
                    <linearGradient id={`${pieId}-revGrad`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                  <Area type="monotone" dataKey="value" name={primaryMetricLabel} stroke={ACCENT} strokeWidth={2} fill={`url(#${pieId}-revGrad)`} />
                  {secondaryMetricLabel && <Area type="monotone" dataKey="secondary" name={secondaryMetricLabel} stroke={CHART_LIGHT} strokeWidth={2} fill="none" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </DashCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <DashCard>
              <p className="text-sm font-semibold t-primary mb-1">Health by Dimension</p>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {pieData.map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1 text-[10px] font-medium t-muted">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} /> {d.name}
                  </span>
                ))}
              </div>
              <div className="h-44 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value" stroke="none">
                      {pieData.map((entry, i) => (
                        <Cell key={`${pieId}-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </DashCard>

            <DashCard>
              <p className="text-sm font-semibold t-primary mb-1">Risk Distribution</p>
              <div className="h-44 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(() => {
                      const severities = ["critical", "high", "medium", "low"];
                      return severities.map((sev) => ({
                        severity: sev.charAt(0).toUpperCase() + sev.slice(1),
                        count: risks.filter((r) => r.severity === sev).length,
                      }));
                    })()}
                    barSize={28}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                    <XAxis dataKey="severity" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {["critical", "high", "medium", "low"].map((sev) => (
                        <Cell key={sev} fill={sev === "critical" ? "#ef4444" : sev === "high" ? "#f59e0b" : ACCENT} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </DashCard>
          </div>
        </div>

        {/* Right sidebar: Quick summaries */}
        <div className="lg:col-span-5 space-y-5">
          <DashCard>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold t-primary flex items-center gap-1.5"><Shield size={14} className="text-accent" /> Risk Summary</p>
              <Link to="/apex" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }}>
                View all <ChevronRight size={10} />
              </Link>
            </div>
            {risks.length === 0 ? (
              <p className="text-xs t-muted py-4 text-center">No active risks detected</p>
            ) : (
              <div className="space-y-2">
                {risks.slice(0, 4).map((risk) => (
                  <div key={risk.id} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${risk.severity === 'critical' ? 'text-red-400' : risk.severity === 'high' ? 'text-amber-400' : 'text-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary truncate">{risk.title}</p>
                      <p className="text-[10px] t-muted truncate">{risk.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={risk.severity === 'critical' ? 'danger' : risk.severity === 'high' ? 'warning' : 'info'} size="sm">{risk.severity}</Badge>
                        <span className="text-[10px] t-muted">{risk.category}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DashCard>

          <DashCard>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold t-primary">Process Metrics</p>
              <Link to="/pulse" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all process metrics">
                View all <ChevronRight size={10} />
              </Link>
            </div>
            <div className="space-y-2.5">
              {metrics.slice(0, 5).map((metric) => (
                <div key={metric.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${metric.status === "green" ? "bg-emerald-500" : metric.status === "amber" ? "bg-amber-500" : "bg-red-500"}`} />
                    <span className="text-xs t-secondary">{metric.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkline data={metric.trend || []} width={40} height={16} color={ACCENT} />
                    <span className="text-xs font-semibold t-primary w-12 text-right">{metric.value}<span className="text-[10px] t-muted ml-0.5">{metric.unit}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </DashCard>

          <DashCard>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold t-primary">Catalyst Activity</p>
              <Link to="/catalysts" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all catalyst activity">
                View all <ChevronRight size={10} />
              </Link>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div>
                <p className="text-2xl font-bold t-primary">{activeCatalysts}</p>
                <p className="text-[10px] t-muted">active</p>
              </div>
              <div>
                <p className="text-2xl font-bold t-primary">{totalTasks}</p>
                <p className="text-[10px] t-muted">tasks</p>
              </div>
            </div>
            <div className="space-y-2">
              {actions.slice(0, 3).map((action) => (
                <div key={action.id} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium t-primary truncate">{action.action}</p>
                    <p className="text-[10px] t-muted truncate">{action.catalystName}</p>
                  </div>
                  <Badge variant={action.status === "completed" ? "success" : action.status === "pending" ? "warning" : "info"}>
                    {action.status}
                  </Badge>
                </div>
              ))}
            </div>
          </DashCard>
        </div>
      </div>
      </>

      )}

      {/* HEALTH TREND TAB */}
      {activeTab === 'health' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <TintedCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Overall Score</p>
              <p className="text-4xl font-bold t-primary">{overallScore}<span className="text-lg t-muted font-normal">/100</span></p>
              <div className="flex items-center gap-1.5 mt-2">
                {trendIcon(healthTrend)}
                <span className={`text-xs ${avgDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(1)} pts avg change
                </span>
              </div>
            </TintedCard>
            <DashCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Improving</p>
              <p className="text-4xl font-bold text-emerald-500">{upCount}</p>
              <p className="text-[10px] t-muted mt-1">dimensions trending up</p>
            </DashCard>
            <DashCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Declining</p>
              <p className="text-4xl font-bold text-red-500">{downCount}</p>
              <p className="text-[10px] t-muted mt-1">dimensions trending down</p>
            </DashCard>
          </div>

          {dimensions.length === 0 ? (
            <DashCard>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <TrendingUp className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No health data yet.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst from the Catalysts page to generate health insights.</p>
              </div>
            </DashCard>
          ) : (
            <>
              <DashCard>
                <p className="text-sm font-semibold t-primary mb-4">All Dimensions</p>
                <div className="space-y-4">
                  {dimensions.map((dim, i) => (
                    <div key={dim.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm" style={{ background: piePalette[i % piePalette.length] }} />
                          <span className="text-xs font-medium t-primary">{dim.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {trendIcon(dim.trend)}
                          <span className={`text-xs ${dim.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {dim.change > 0 ? '+' : ''}{dim.change}
                          </span>
                          <span className="text-sm font-bold t-primary w-8 text-right">{dim.score}</span>
                        </div>
                      </div>
                      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${dim.score}%`, background: piePalette[i % piePalette.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </DashCard>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <DashCard>
                  <p className="text-sm font-semibold t-primary mb-3">Health Score Trend</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={metricsOverTime}>
                        <defs>
                          <linearGradient id={`${pieId}-htGrad`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '12px', fontSize: '11px' }} />
                        <Area type="monotone" dataKey="value" name="Health" stroke={ACCENT} strokeWidth={2} fill={`url(#${pieId}-htGrad)`} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </DashCard>
                <DashCard>
                  <p className="text-sm font-semibold t-primary mb-3">Month-over-Month Change</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={momData} barSize={16}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '12px', fontSize: '11px' }} />
                        <Bar dataKey="change" radius={[4, 4, 0, 0]} fill={ACCENT} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </DashCard>
              </div>
            </>
          )}
        </div>
      )}

      {/* RISKS TAB */}
      {activeTab === 'risks' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
              const count = risks.filter((r) => r.severity === sev).length;
              const color = sev === 'critical' ? '#ef4444' : sev === 'high' ? '#f59e0b' : sev === 'medium' ? ACCENT : SKY;
              return (
                <DashCard key={sev}>
                  <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">{sev}</p>
                  <p className="text-4xl font-bold" style={{ color }}>{count}</p>
                  <p className="text-[10px] t-muted mt-1">{sev} severity risks</p>
                </DashCard>
              );
            })}
          </div>

          {risks.length === 0 ? (
            <DashCard>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No risk alerts detected yet.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst to scan for organisational risks.</p>
              </div>
            </DashCard>
          ) : (
            <>
              <DashCard>
                <p className="text-sm font-semibold t-primary mb-3">Risk Distribution</p>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(['critical', 'high', 'medium', 'low'] as const).map((sev) => ({
                        severity: sev.charAt(0).toUpperCase() + sev.slice(1),
                        count: risks.filter((r) => r.severity === sev).length,
                      }))}
                      barSize={40}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                      <XAxis dataKey="severity" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '12px', fontSize: '11px' }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {['critical', 'high', 'medium', 'low'].map((sev) => (
                          <Cell key={sev} fill={sev === 'critical' ? '#ef4444' : sev === 'high' ? '#f59e0b' : sev === 'medium' ? ACCENT : SKY} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashCard>

              <DashCard>
                <p className="text-sm font-semibold t-primary mb-3">All Risk Alerts</p>
                <div className="space-y-3">
                  {risks.map((risk) => (
                    <div key={risk.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                      <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        risk.severity === 'critical' ? 'text-red-500' : risk.severity === 'high' ? 'text-amber-500' : 'text-gray-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold t-primary">{risk.title}</h4>
                          <Badge variant={risk.severity === 'critical' ? 'danger' : risk.severity === 'high' ? 'warning' : 'info'}>{risk.severity}</Badge>
                        </div>
                        <p className="text-[10px] t-muted mt-0.5">{risk.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] t-muted">
                          <span>Probability: {Math.round(risk.probability * 100)}%</span>
                          <span>Impact: {risk.impactValue} {risk.impactUnit}</span>
                          <Badge variant="outline" size="sm">{risk.category}</Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </DashCard>
            </>
          )}
        </div>
      )}

      {/* ANOMALIES & CONTROL PLANE HEALTH — Bug #7 fix: render previously discarded data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <DashCard>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold t-primary">Recent Anomalies</p>
            <Link to="/pulse" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all anomalies">
              View all <ChevronRight size={10} />
            </Link>
          </div>
          {anomalies.length === 0 ? (
            <p className="text-xs t-muted">No anomalies detected</p>
          ) : (
            <div className="space-y-2.5">
              {anomalies.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium t-primary truncate">{a.metric}</p>
                    <p className="text-[10px] t-muted">Deviation: {typeof a.deviation === 'number' ? `${a.deviation > 0 ? '+' : ''}${a.deviation.toFixed(1)}%` : '--'}</p>
                  </div>
                  <Badge variant={a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warning' : 'info'}>
                    {a.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </DashCard>

        <DashCard>
          <p className="text-sm font-semibold t-primary mb-3">Control Plane</p>
          {!cpHealth ? (
            <p className="text-xs t-muted">No data available</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Overall Health</span>
                <Badge variant={cpHealth.overallHealth >= 90 ? 'success' : cpHealth.overallHealth >= 70 ? 'warning' : 'danger'}>
                  {cpHealth.overallHealth}%
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Uptime</span>
                <span className="text-xs font-semibold t-primary">{cpHealth.overallUptime?.toFixed(1) ?? '--'}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Deployments</span>
                <span className="text-xs font-semibold t-primary">{cpHealth.deploymentStatus ? Object.values(cpHealth.deploymentStatus).reduce((a, b) => a + b, 0) : '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Last Checked</span>
                <span className="text-xs font-semibold t-primary">{cpHealth.lastChecked ? new Date(cpHealth.lastChecked).toLocaleTimeString() : '--'}</span>
              </div>
            </div>
          )}
        </DashCard>
      </div>

      {/* QUICK LINKS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Apex", desc: "Executive Intelligence", to: "/apex" },
          { label: "Pulse", desc: "Process Monitoring", to: "/pulse" },
          { label: "Memory", desc: "Knowledge Base", to: "/memory" },
          { label: "Mind", desc: "AI Models", to: "/mind" },
        ].map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="rounded-xl p-4 transition-all hover:-translate-y-0.5"
            style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", boxShadow: "0 2px 8px rgba(100, 120, 180, 0.06)" }}
          >
            <p className="text-sm font-semibold t-primary">{item.label}</p>
            <p className="text-[10px] t-muted">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* Traceability Modal */}
      {showTraceModal && traceData && (
        <TraceabilityModal
          data={traceData}
          type="dimension"
          onClose={() => { setShowTraceModal(false); setTraceData(null); }}
        />
      )}
    </div>
  );
}
