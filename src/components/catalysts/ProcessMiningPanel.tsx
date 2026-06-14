import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ScrollText,
  Eye,
  Sparkles,
  Activity,
  GitBranch,
  TrendingDown,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { ClusterItem, RunAnalytics, RunAnalyticsAggregate } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────
export type RunDetailAction = {
  id: string;
  action: string;
  status: string;
  confidence: number;
  assignedTo?: string;
  processingTimeMs?: number;
  createdAt: string;
};

type RunDetailActionsMap = Record<string, RunDetailAction[]>;

interface ProcessMiningPanelProps {
  runAnalytics: RunAnalytics[];
  runAggregate: RunAnalyticsAggregate | null;
  clusters: ClusterItem[];
  analyticsLoading: boolean;
  analyticsCluster: string;
  setAnalyticsCluster: (v: string) => void;
  loadRunAnalytics: () => void;
  expandedAnalyticsRun: string | null;
  setExpandedAnalyticsRun: (id: string | null) => void;
  runDetailActions: RunDetailActionsMap;
  setRunDetailActions: React.Dispatch<React.SetStateAction<RunDetailActionsMap>>;
  runDetailLoading: string | null;
  setRunDetailLoading: (id: string | null) => void;
}

// ── Process Mining primitives ────────────────────────────────────────────
// Buckets follow operational cadence: sub-second through long-running tasks.
const CYCLE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "0–1s", max: 1_000 },
  { label: "1–5s", max: 5_000 },
  { label: "5–15s", max: 15_000 },
  { label: "15–60s", max: 60_000 },
  { label: "1–5m", max: 300_000 },
  { label: ">5m", max: Number.POSITIVE_INFINITY },
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function bucketCycleTimes(times: number[]): number[] {
  const counts = new Array(CYCLE_BUCKETS.length).fill(0);
  times.forEach((t) => {
    for (let i = 0; i < CYCLE_BUCKETS.length; i++) {
      if (t <= CYCLE_BUCKETS[i].max) {
        counts[i] += 1;
        break;
      }
    }
  });
  return counts;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── Per-run process mining card ──────────────────────────────────────────
function ProcessMiningRunCard({
  actions,
}: {
  actions: RunDetailAction[];
}) {
  const cycleTimes = actions
    .map((a) => a.processingTimeMs)
    .filter((v): v is number => typeof v === "number" && v > 0);

  if (cycleTimes.length === 0) {
    return (
      <div className="p-3 rounded-[2px] border border-[var(--border-card)]" style={{ background: "#fbfaf7" }}>
        <p className="text-xs t-muted">No processing-time data available for this run.</p>
      </div>
    );
  }

  const buckets = bucketCycleTimes(cycleTimes);
  const maxBucket = Math.max(...buckets, 1);
  const p50 = percentile(cycleTimes, 50);
  const p95 = percentile(cycleTimes, 95);
  const maxT = Math.max(...cycleTimes);

  // Path frequency: composite key of status + exception_type-ish derivation
  // (items API isn't called here — we approximate exceptions via action.status).
  const pathCounts = new Map<string, number>();
  actions.forEach((a) => {
    const key = a.status || "unknown";
    pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
  });
  const totalActions = actions.length;
  const topPaths = Array.from(pathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const accent = "var(--accent)";

  return (
    <div className="space-y-3">
      {/* Cycle-time histogram + stats card */}
      <div
        className="p-3 rounded-[2px] border border-[var(--border-card)] grid grid-cols-1 md:grid-cols-3 gap-3"
        style={{ background: "#fbfaf7" }}
      >
        <div className="md:col-span-2">
          <h5 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1">
            <Activity size={12} style={{ color: accent }} /> Cycle-Time Histogram
          </h5>
          <div className="space-y-1">
            {CYCLE_BUCKETS.map((b, i) => {
              const count = buckets[i];
              const pct = (count / maxBucket) * 100;
              const sharePct = totalActions ? (count / totalActions) * 100 : 0;
              return (
                <div key={b.label} className="grid grid-cols-12 items-center gap-2 text-[11px]">
                  <span className="col-span-2 t-secondary tabular-nums">{b.label}</span>
                  <div className="col-span-8 h-3 rounded-[2px]" style={{ background: "rgba(36,86,214,0.08)" }}>
                    <div
                      className="h-3 rounded-[2px]"
                      style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%`, background: accent }}
                    />
                  </div>
                  <span className="col-span-2 text-right t-muted tabular-nums">
                    {count} <span className="t-muted">({sharePct.toFixed(0)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-[2px] border border-[var(--border-card)] p-2" style={{ background: "#ffffff" }}>
          <p className="text-[10px] uppercase tracking-wider t-muted mb-1">Cycle Stats</p>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] t-secondary">P50</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: accent }}>{formatMs(p50)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] t-secondary">P95</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: accent }}>{formatMs(p95)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] t-secondary">Max</span>
              <span className="text-sm font-semibold tabular-nums t-primary">{formatMs(maxT)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1 border-t border-[var(--border-card)]">
              <span className="text-[11px] t-muted">N</span>
              <span className="text-xs tabular-nums t-primary">{cycleTimes.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Path frequency table */}
      <div className="p-3 rounded-[2px] border border-[var(--border-card)]" style={{ background: "#fbfaf7" }}>
        <h5 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1">
          <GitBranch size={12} style={{ color: accent }} /> Path Frequency
          <span className="t-muted font-normal">(top 5)</span>
        </h5>
        <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider t-muted pb-1 border-b border-[var(--border-card)]">
          <span className="col-span-7">Path</span>
          <span className="col-span-2 text-right">Count</span>
          <span className="col-span-3 text-right">Share</span>
        </div>
        {topPaths.map(([path, count]) => {
          const sharePct = (count / totalActions) * 100;
          return (
            <div key={path} className="grid grid-cols-12 gap-2 items-center py-1 border-b border-[var(--border-card)]/40 text-[11px]">
              <span className="col-span-7 t-secondary truncate" title={path}>{path}</span>
              <span className="col-span-2 text-right tabular-nums t-primary">{count}</span>
              <span className="col-span-3 text-right">
                <div className="inline-flex items-center gap-1.5">
                  <div className="w-14 h-1.5 rounded-[2px]" style={{ background: "rgba(36,86,214,0.08)" }}>
                    <div className="h-1.5 rounded-[2px]" style={{ width: `${sharePct}%`, background: accent }} />
                  </div>
                  <span className="tabular-nums t-secondary">{sharePct.toFixed(0)}%</span>
                </div>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bottleneck rank (cluster-level) ──────────────────────────────────────
function BottleneckRank({
  runs,
  runDetailActions,
}: {
  runs: RunAnalytics[];
  runDetailActions: RunDetailActionsMap;
}) {
  // Derive per-sub_catalyst average processing time (ms per item).
  // Prefer real action processingTimeMs averages when available, otherwise
  // fall back to durationMs / total items.
  const perSub = new Map<string, { totalMs: number; n: number; usedDetail: boolean }>();

  runs.forEach((run) => {
    const subName = run.subCatalystName || "(unspecified)";
    const detail = runDetailActions[run.runId];
    let avg: number | null = null;
    let usedDetail = false;

    if (detail && detail.length > 0) {
      const times = detail
        .map((a) => a.processingTimeMs)
        .filter((v): v is number => typeof v === "number" && v > 0);
      if (times.length > 0) {
        avg = times.reduce((s, v) => s + v, 0) / times.length;
        usedDetail = true;
      }
    }

    if (avg === null && run.durationMs && run.summary.total > 0) {
      avg = run.durationMs / run.summary.total;
    }

    if (avg === null) return;

    const cur = perSub.get(subName) || { totalMs: 0, n: 0, usedDetail: false };
    cur.totalMs += avg;
    cur.n += 1;
    cur.usedDetail = cur.usedDetail || usedDetail;
    perSub.set(subName, cur);
  });

  const ranked = Array.from(perSub.entries())
    .map(([name, agg]) => ({ name, avg: agg.totalMs / agg.n, usedDetail: agg.usedDetail }))
    .sort((a, b) => b.avg - a.avg);

  if (ranked.length === 0) {
    return null;
  }

  const med = median(ranked.map((r) => r.avg));
  const top3 = ranked.slice(0, 3);
  const accent = "var(--accent)";

  return (
    <div className="p-3 rounded-[2px] border border-[var(--border-card)]" style={{ background: "#fbfaf7" }}>
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-semibold t-primary flex items-center gap-1">
          <TrendingDown size={12} style={{ color: accent }} /> Bottleneck Rank
        </h5>
        <span className="text-[10px] t-muted">vs median {formatMs(med)}</span>
      </div>
      <div className="space-y-1.5">
        {top3.map((row, i) => {
          const delta = row.avg - med;
          const deltaPct = med > 0 ? (delta / med) * 100 : 0;
          const slowest = ranked[0].avg;
          const relWidth = slowest > 0 ? (row.avg / slowest) * 100 : 0;
          return (
            <div key={row.name} className="grid grid-cols-12 items-center gap-2 text-[11px]">
              <span className="col-span-1 t-muted tabular-nums">#{i + 1}</span>
              <span className="col-span-5 t-secondary truncate" title={row.name}>{row.name}</span>
              <div className="col-span-3 h-2 rounded-[2px]" style={{ background: "rgba(36,86,214,0.08)" }}>
                <div className="h-2 rounded-[2px]" style={{ width: `${relWidth}%`, background: accent }} />
              </div>
              <span className="col-span-2 text-right tabular-nums font-semibold" style={{ color: accent }}>
                {formatMs(row.avg)}
              </span>
              <span
                className="col-span-1 text-right tabular-nums text-[10px]"
                style={{ color: delta > 0 ? "var(--neg)" : "var(--positive)" }}
              >
                {delta > 0 ? "+" : ""}{deltaPct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
      {!top3.every((r) => r.usedDetail) && (
        <p className="text-[10px] t-muted mt-2 italic">
          Some rows derived from durationMs / item count (no per-action timing yet — load items on a run to refine).
        </p>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────
export function ProcessMiningPanel(props: ProcessMiningPanelProps) {
  const {
    runAnalytics,
    runAggregate,
    clusters,
    analyticsLoading,
    analyticsCluster,
    setAnalyticsCluster,
    loadRunAnalytics,
    expandedAnalyticsRun,
    setExpandedAnalyticsRun,
    runDetailActions,
    setRunDetailActions,
    runDetailLoading,
    setRunDetailLoading,
  } = props;

  const toast = useToast();
  const accent = "var(--accent)";

  // Aggregate insights across runs — dedupe + cap.
  const aggregatedInsights = Array.from(
    new Set(runAnalytics.flatMap((r) => r.insights || []))
  ).slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
          <BarChart3 size={18} style={{ color: accent }} /> Process Mining &amp; Run Analytics
        </h3>
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-1.5 rounded-[2px] bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs t-primary"
            value={analyticsCluster}
            onChange={(e) => setAnalyticsCluster(e.target.value)}
          >
            <option value="all">All Clusters</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={loadRunAnalytics} disabled={analyticsLoading}>
            {analyticsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </Button>
        </div>
      </div>

      {/* Process insights (aggregated from run.insights[]) */}
      {!analyticsLoading && aggregatedInsights.length > 0 && (
        <div
          className="p-3 rounded-[2px] border border-[var(--border-card)]"
          style={{ background: "#fbfaf7" }}
        >
          <h5 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1">
            <Sparkles size={12} style={{ color: accent }} /> Process Insights
          </h5>
          <ul className="space-y-1">
            {aggregatedInsights.map((insight, i) => (
              <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
                <span style={{ color: accent }} className="mt-0.5">&bull;</span> {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cluster-level bottleneck rank */}
      {!analyticsLoading && runAnalytics.length > 0 && (
        <BottleneckRank runs={runAnalytics} runDetailActions={runDetailActions} />
      )}

      {analyticsLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: accent }} />
        </div>
      )}

      {!analyticsLoading && runAggregate && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card variant="default"><div className="text-center"><p className="text-label">Total Runs</p><p className="text-xl font-bold t-primary mt-1">{runAggregate.totalRuns}</p></div></Card>
          <Card variant="default"><div className="text-center"><p className="text-label">Items Processed</p><p className="text-xl font-bold t-primary mt-1">{runAggregate.totalItems}</p></div></Card>
          <Card variant="default"><div className="text-center"><p className="text-label">Completed</p><p className="text-xl font-bold mt-1" style={{ color: "var(--positive)" }}>{runAggregate.totalCompleted}</p></div></Card>
          <Card variant="default"><div className="text-center"><p className="text-label">Exceptions</p><p className="text-xl font-bold mt-1" style={{ color: "var(--neg)" }}>{runAggregate.totalExceptions}</p></div></Card>
          <Card variant="default"><div className="text-center"><p className="text-label">Escalated</p><p className="text-xl font-bold mt-1" style={{ color: "var(--warning)" }}>{runAggregate.totalEscalated}</p></div></Card>
          <Card variant="default"><div className="text-center"><p className="text-label">Avg Confidence</p><p className="text-xl font-bold mt-1 t-secondary">{(runAggregate.avgConfidence * 100).toFixed(0)}%</p></div></Card>
          <Card variant="default"><div className="text-center"><p className="text-label">Automation Rate</p><p className="text-xl font-bold mt-1" style={{ color: accent }}>{(runAggregate.automationRate * 100).toFixed(0)}%</p></div></Card>
        </div>
      )}

      {!analyticsLoading && runAnalytics.length === 0 && (
        <div className="flex items-center gap-3 py-6 px-4">
          <BarChart3 size={16} className="t-muted opacity-40 flex-shrink-0" />
          <p className="text-sm t-muted">No run analytics yet</p>
        </div>
      )}

      {!analyticsLoading && runAnalytics.length > 0 && (
        <div className="space-y-3">
          {runAnalytics.map((run) => {
            const isExp = expandedAnalyticsRun === run.id;
            return (
              <Card
                key={run.id}
                hover
                onClick={() => setExpandedAnalyticsRun(isExp ? null : run.id)}
                className={isExp ? "border-accent/20" : ""}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold t-primary">{run.clusterName || run.clusterId}</h4>
                      {run.subCatalystName && <Badge variant="outline" size="sm">{run.subCatalystName}</Badge>}
                    </div>
                    <p className="text-xs t-muted mt-0.5">
                      Run {run.runId.slice(0, 8)} &mdash; {new Date(run.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={run.status === "completed" ? "success" : run.status === "running" ? "info" : "warning"}>{run.status}</Badge>
                    {run.durationMs && <span className="text-xs t-muted">{(run.durationMs / 1000).toFixed(1)}s</span>}
                    {isExp ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
                  </div>
                </div>

                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3">
                  <div className="text-center p-2 rounded-[2px] bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <span className="text-caption t-muted">Total</span>
                    <p className="text-sm font-bold t-primary">{run.summary.total}</p>
                  </div>
                  <div className="text-center p-2 rounded-[2px] border" style={{ background: "rgb(var(--accent-rgb) / 0.05)", borderColor: "rgb(var(--accent-rgb) / 0.15)" }}>
                    <span className="text-caption" style={{ color: "var(--positive)" }}>Completed</span>
                    <p className="text-sm font-bold" style={{ color: "var(--positive)" }}>{run.summary.completed}</p>
                  </div>
                  <div className="text-center p-2 rounded-[2px] border" style={{ background: "rgb(var(--neg-rgb) / 0.05)", borderColor: "rgb(var(--neg-rgb) / 0.15)" }}>
                    <span className="text-caption" style={{ color: "var(--neg)" }}>Exceptions</span>
                    <p className="text-sm font-bold" style={{ color: "var(--neg)" }}>{run.summary.exceptions}</p>
                  </div>
                  <div className="text-center p-2 rounded-[2px] border" style={{ background: "rgba(154,107,31,0.05)", borderColor: "rgba(154,107,31,0.15)" }}>
                    <span className="text-caption" style={{ color: "var(--warning)" }}>Escalated</span>
                    <p className="text-sm font-bold" style={{ color: "var(--warning)" }}>{run.summary.escalated}</p>
                  </div>
                  <div className="text-center p-2 rounded-[2px] border border-[var(--border-card)] bg-[var(--bg-secondary)]">
                    <span className="text-caption t-muted">Pending</span>
                    <p className="text-sm font-bold t-secondary">{run.summary.pending}</p>
                  </div>
                  <div className="text-center p-2 rounded-[2px] border" style={{ background: "rgba(36,86,214,0.05)", borderColor: "rgba(36,86,214,0.15)" }}>
                    <span className="text-caption" style={{ color: accent }}>Auto-Approved</span>
                    <p className="text-sm font-bold" style={{ color: accent }}>{run.summary.autoApproved}</p>
                  </div>
                </div>

                {isExp && (
                  <div className="mt-4 space-y-3 animate-fadeIn">
                    <div className="p-3 rounded-[2px] bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <h5 className="text-xs font-semibold t-primary mb-2">Confidence Distribution</h5>
                      <div className="flex items-end gap-1 h-16">
                        {Object.entries(run.confidence.distribution).map(([bucket, count]) => {
                          const maxCount = Math.max(...Object.values(run.confidence.distribution), 1);
                          const height = (count / maxCount) * 100;
                          return (
                            <div key={bucket} className="flex-1 flex flex-col items-center gap-1">
                              <div className="w-full rounded-t-[2px]" style={{ height: `${Math.max(height, 4)}%`, background: "rgba(36,86,214,0.3)" }} />
                              <span className="text-[8px] t-muted">{bucket}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-2 text-caption t-muted">
                        <span>Avg: <span className="font-medium t-primary">{(run.confidence.avg * 100).toFixed(0)}%</span></span>
                        <span>Min: <span className="font-medium t-primary">{(run.confidence.min * 100).toFixed(0)}%</span></span>
                        <span>Max: <span className="font-medium t-primary">{(run.confidence.max * 100).toFixed(0)}%</span></span>
                      </div>
                    </div>

                    {/* Per-Run Transaction Detail loader */}
                    <div className="p-3 rounded-[2px] bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-semibold t-primary flex items-center gap-1">
                          <ScrollText size={12} style={{ color: accent }} /> Transaction Detail
                        </h5>
                        {!runDetailActions[run.runId] && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async (e) => {
                              e.stopPropagation();
                              setRunDetailLoading(run.runId);
                              try {
                                const res = await api.catalysts.runAnalyticsDetail(run.runId);
                                setRunDetailActions((prev) => ({ ...prev, [run.runId]: res.actions }));
                              } catch (err) {
                                console.error("Failed to load run detail", err);
                                toast.error("Failed to load run items", {
                                  message: err instanceof Error ? err.message : "Unknown error",
                                  requestId: err instanceof ApiError ? err.requestId : null,
                                });
                              }
                              setRunDetailLoading(null);
                            }}
                          >
                            {runDetailLoading === run.runId ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />} Load Items
                          </Button>
                        )}
                      </div>
                      {runDetailLoading === run.runId && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: accent }} />
                          <span className="text-xs t-muted ml-2">Loading transaction items...</span>
                        </div>
                      )}
                      {runDetailActions[run.runId] && runDetailActions[run.runId].length === 0 && (
                        <p className="text-xs t-muted text-center py-3">No individual action items recorded for this run.</p>
                      )}
                      {runDetailActions[run.runId] && runDetailActions[run.runId].length > 0 && (
                        <div className="space-y-1 max-h-[300px] overflow-y-auto">
                          <div className="grid grid-cols-12 gap-2 text-caption t-muted uppercase tracking-wider font-semibold pb-1 border-b border-[var(--border-card)] sticky top-0 bg-[var(--bg-secondary)]">
                            <span className="col-span-4">Action</span>
                            <span className="col-span-2">Status</span>
                            <span className="col-span-2 text-right">Confidence</span>
                            <span className="col-span-2">Assigned To</span>
                            <span className="col-span-2 text-right">Time</span>
                          </div>
                          {runDetailActions[run.runId].map((item) => (
                            <div key={item.id} className="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)]/50 rounded-[2px] px-1">
                              <span className="col-span-4 text-xs t-secondary truncate" title={item.action}>{item.action}</span>
                              <span className="col-span-2">
                                <Badge
                                  variant={
                                    item.status === "completed" || item.status === "approved"
                                      ? "success"
                                      : item.status === "exception" || item.status === "failed" || item.status === "rejected"
                                      ? "danger"
                                      : item.status === "escalated"
                                      ? "warning"
                                      : "info"
                                  }
                                  size="sm"
                                >
                                  {item.status}
                                </Badge>
                              </span>
                              <span
                                className="col-span-2 text-xs font-medium text-right"
                                style={{
                                  color:
                                    item.confidence >= 0.8
                                      ? "var(--positive)"
                                      : item.confidence >= 0.6
                                      ? "var(--warning)"
                                      : "var(--neg)",
                                }}
                              >
                                {(item.confidence * 100).toFixed(0)}%
                              </span>
                              <span className="col-span-2 text-caption t-muted truncate">{item.assignedTo || "—"}</span>
                              <span className="col-span-2 text-caption t-muted text-right">
                                {item.processingTimeMs ? `${(item.processingTimeMs / 1000).toFixed(1)}s` : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Process mining per-run (histogram + stats + path frequency) */}
                    {runDetailActions[run.runId] && runDetailActions[run.runId].length > 0 && (
                      <ProcessMiningRunCard actions={runDetailActions[run.runId]} />
                    )}

                    {run.insights.length > 0 && (
                      <div className="p-3 rounded-[2px] bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <h5 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1">
                          <Sparkles size={12} style={{ color: accent }} /> AI Insights
                        </h5>
                        <ul className="space-y-1">
                          {run.insights.map((insight, i) => (
                            <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
                              <span style={{ color: accent }} className="mt-0.5">&bull;</span> {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
