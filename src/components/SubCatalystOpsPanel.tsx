import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, API_URL } from "@/lib/api";
import type {
  SubCatalystRun, SubCatalystRunDetail, SubCatalystKpis,
  SubCatalystRunItemsResponse,
  SubCatalystRunComparison, RunComment,
} from "@/lib/api";
import {
  X, Activity, Clock, Settings, CheckCircle, XCircle,
  AlertTriangle, Download,
  FileCheck, Loader2, Send, Eye,
  ThumbsUp, ThumbsDown, RotateCcw, Filter,
} from "lucide-react";

interface SubCatalystOpsPanelProps {
  clusterId: string;
  clusterName: string;
  subCatalystName: string;
  onClose: () => void;
}

type TabId = 'overview' | 'history' | 'detail' | 'config';

const statusColor = (s: string) =>
  s === 'green' ? 'text-emerald-400' : s === 'amber' ? 'text-amber-400' : s === 'red' ? 'text-red-400' : 'text-gray-400';

const statusBg = (s: string) =>
  s === 'green' ? 'bg-emerald-400/10 border-emerald-400/30' : s === 'amber' ? 'bg-amber-400/10 border-amber-400/30' : s === 'red' ? 'bg-red-400/10 border-red-400/30' : 'bg-gray-400/10 border-gray-400/30';

const runStatusIcon = (status: string) => {
  if (status === 'completed') return <CheckCircle size={14} className="text-emerald-400" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-400" />;
  if (status === 'partial') return <AlertTriangle size={14} className="text-amber-400" />;
  return <Clock size={14} className="text-gray-400" />;
};

const fmtDuration = (ms?: number) => {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const fmtCurrency = (val: number, currency = 'ZAR') => {
  if (!val) return `${currency} 0.00`;
  return `${currency} ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (d?: string) => {
  if (!d) return '-';
  return new Date(d).toLocaleString();
};

const parseTrend = (s: string): number[] => {
  try { return JSON.parse(s); } catch { return []; }
};

function MiniSparkline({ data, color = '#60a5fa' }: { data: number[]; color?: string }) {
  if (!data.length) return <span className="text-xs text-white/30">No data</span>;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => `${(i / (data.length - 1 || 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function SubCatalystOpsPanel({ clusterId, clusterName, subCatalystName, onClose }: SubCatalystOpsPanelProps) {
  const [tab, setTab] = useState<TabId>('overview');
  const [kpis, setKpis] = useState<SubCatalystKpis | null>(null);
  const [runs, setRuns] = useState<SubCatalystRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<SubCatalystRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [items, setItems] = useState<SubCatalystRunItemsResponse | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [comments, setComments] = useState<RunComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [comparison, setComparison] = useState<SubCatalystRunComparison | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [signOffNotes, setSignOffNotes] = useState('');
  const [kpiLoading, setKpiLoading] = useState(false);

  // Filter state for history tab
  const [historyFilter, setHistoryFilter] = useState<{ status?: string; from?: string; to?: string; triggered_by?: string }>({});
  const [historyPage, setHistoryPage] = useState(0);

  // Items filter
  const [itemFilter, setItemFilter] = useState<{ status?: string; severity?: string; review_status?: string }>({});
  const [itemPage, setItemPage] = useState(0);

  // Threshold editing
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [savingThresholds, setSavingThresholds] = useState(false);

  // Review state
  const [, setReviewingItem] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const loadKpis = useCallback(async () => {
    setKpiLoading(true);
    try {
      const res = await api.catalysts.getSubCatalystKpis(clusterId, subCatalystName);
      setKpis(res.kpis);
      if (res.kpis) {
        setThresholds({
          threshold_success_green: res.kpis.threshold_success_green,
          threshold_success_amber: res.kpis.threshold_success_amber,
          threshold_success_red: res.kpis.threshold_success_red,
          threshold_duration_green: res.kpis.threshold_duration_green,
          threshold_duration_amber: res.kpis.threshold_duration_amber,
          threshold_duration_red: res.kpis.threshold_duration_red,
          threshold_discrepancy_green: res.kpis.threshold_discrepancy_green,
          threshold_discrepancy_amber: res.kpis.threshold_discrepancy_amber,
          threshold_discrepancy_red: res.kpis.threshold_discrepancy_red,
        });
      }
    } catch (err) { console.error('loadKpis failed:', err); }
    setKpiLoading(false);
  }, [clusterId, subCatalystName]);

  const loadRuns = useCallback(async (page = 0) => {
    setRunsLoading(true);
    try {
      const res = await api.catalysts.getSubCatalystRuns(clusterId, subCatalystName, {
        limit: 20, offset: page * 20,
        ...historyFilter,
      });
      setRuns(res.runs);
      setRunsTotal(res.total);
    } catch (err) { console.error('loadRuns failed:', err); }
    setRunsLoading(false);
  }, [clusterId, subCatalystName, historyFilter]);

  const loadRunDetail = useCallback(async (runId: string) => {
    setDetailLoading(true);
    setTab('detail');
    try {
      const [detail, commentsRes] = await Promise.all([
        api.catalysts.getSubCatalystRunDetail(clusterId, subCatalystName, runId),
        api.catalysts.getRunComments(runId),
      ]);
      setSelectedRun(detail);
      setComments(commentsRes.comments);
      // Load items
      setItemsLoading(true);
      const itemsRes = await api.catalysts.getRunItems(runId, { limit: 50, offset: 0 });
      setItems(itemsRes);
      setItemsLoading(false);
    } catch (err) { console.error('loadRunDetail failed:', err); }
    setDetailLoading(false);
  }, [clusterId, subCatalystName]);

  useEffect(() => { loadKpis(); loadRuns(); }, [loadKpis, loadRuns]);

  const handleReview = async (itemId: string, reviewStatus: string) => {
    if (!selectedRun) return;
    setReviewingItem(itemId);
    try {
      await api.catalysts.reviewRunItem(selectedRun.run.id, itemId, { review_status: reviewStatus, review_notes: reviewNotes });
      setReviewNotes('');
      setReviewingItem(null);
      // Reload items
      const itemsRes = await api.catalysts.getRunItems(selectedRun.run.id, { limit: 50, offset: itemPage * 50, ...itemFilter });
      setItems(itemsRes);
    } catch (err) { console.error('review failed:', err); }
  };

  const handleBulkReview = async (reviewStatus: string) => {
    if (!selectedRun || selectedItemIds.size === 0) return;
    try {
      await api.catalysts.bulkReviewRunItems(selectedRun.run.id, {
        item_ids: Array.from(selectedItemIds), review_status: reviewStatus, review_notes: reviewNotes,
      });
      setSelectedItemIds(new Set());
      setReviewNotes('');
      const itemsRes = await api.catalysts.getRunItems(selectedRun.run.id, { limit: 50, offset: itemPage * 50, ...itemFilter });
      setItems(itemsRes);
    } catch (err) { console.error('bulkReview failed:', err); }
  };

  const handleSignOff = async (status: string) => {
    if (!selectedRun) return;
    try {
      await api.catalysts.signOffRun(selectedRun.run.id, { status, notes: signOffNotes });
      setSignOffNotes('');
      loadRunDetail(selectedRun.run.id);
    } catch (err) { console.error('signOff failed:', err); }
  };

  const handleCompare = async (runBId: string) => {
    if (!selectedRun) return;
    try {
      const res = await api.catalysts.compareRuns(selectedRun.run.id, runBId);
      setComparison(res);
      setCompareRunId(runBId);
    } catch (err) { console.error('compare failed:', err); }
  };

  const handleRetry = async () => {
    if (!selectedRun) return;
    try {
      const res = await api.catalysts.retryRun(selectedRun.run.id);
      if (res.redirect) {
        await api.catalysts.executeSubCatalyst(res.cluster_id, res.sub_catalyst_name);
        loadRuns(historyPage);
      }
    } catch (err) { console.error('retry failed:', err); }
  };

  const handleAddComment = async () => {
    if (!selectedRun || !newComment.trim()) return;
    try {
      await api.catalysts.addRunComment(selectedRun.run.id, { comment: newComment.trim() });
      setNewComment('');
      const commentsRes = await api.catalysts.getRunComments(selectedRun.run.id);
      setComments(commentsRes.comments);
    } catch (err) { console.error('addComment failed:', err); }
  };

  const handleSaveThresholds = async () => {
    setSavingThresholds(true);
    try {
      const res = await api.catalysts.updateSubCatalystThresholds(clusterId, subCatalystName, thresholds);
      if (res.kpis) setKpis(res.kpis);
    } catch (err) { console.error('saveThresholds failed:', err); }
    setSavingThresholds(false);
  };

  const handleLoadItems = async (page: number) => {
    if (!selectedRun) return;
    setItemsLoading(true);
    setItemPage(page);
    try {
      const res = await api.catalysts.getRunItems(selectedRun.run.id, { limit: 50, offset: page * 50, ...itemFilter });
      setItems(res);
    } catch (err) { console.error('loadItems failed:', err); }
    setItemsLoading(false);
  };

  // ========== RENDER ==========

  const renderOverview = () => (
    <div className="space-y-4">
      {kpiLoading ? (
        <div className="flex items-center gap-2 p-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading KPIs...</div>
      ) : !kpis ? (
        <div className="text-center text-white/50 p-8">No runs yet. Execute the sub-catalyst to see KPIs.</div>
      ) : (
        <>
          {/* Status indicator */}
          <div className={`border rounded-lg p-4 ${statusBg(kpis.status)}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${kpis.status === 'green' ? 'bg-emerald-400' : kpis.status === 'amber' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <span className={`font-semibold ${statusColor(kpis.status)}`}>{kpis.status.toUpperCase()}</span>
              </div>
              <span className="text-xs text-white/50">Last run: {fmtDate(kpis.last_run_at)}</span>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-3 bg-surface border-white/5">
              <div className="text-xs text-white/50 mb-1">Success Rate</div>
              <div className="text-xl font-bold text-emerald-400">{kpis.success_rate}%</div>
              <MiniSparkline data={parseTrend(kpis.success_trend)} color="#34d399" />
              <div className="text-xs text-white/30 mt-1">{kpis.total_runs} runs ({kpis.successful_runs} ok, {kpis.failed_runs} fail)</div>
            </Card>
            <Card className="p-3 bg-surface border-white/5">
              <div className="text-xs text-white/50 mb-1">Avg Duration</div>
              <div className="text-xl font-bold text-accent">{fmtDuration(kpis.avg_duration_ms)}</div>
              <MiniSparkline data={parseTrend(kpis.duration_trend)} color="#60a5fa" />
              <div className="text-xs text-white/30 mt-1">{kpis.avg_records_processed} records/run</div>
            </Card>
            <Card className="p-3 bg-surface border-white/5">
              <div className="text-xs text-white/50 mb-1">Discrepancy Rate</div>
              <div className="text-xl font-bold text-amber-400">{kpis.avg_discrepancy_rate}%</div>
              <MiniSparkline data={parseTrend(kpis.discrepancy_trend)} color="#fbbf24" />
              <div className="text-xs text-white/30 mt-1">Match rate: {kpis.avg_match_rate}%</div>
            </Card>
            <Card className="p-3 bg-surface border-white/5">
              <div className="text-xs text-white/50 mb-1">Avg Confidence</div>
              <div className="text-xl font-bold text-purple-400">{(kpis.avg_confidence * 100).toFixed(0)}%</div>
              <MiniSparkline data={parseTrend(kpis.confidence_trend)} color="#a78bfa" />
              <div className="text-xs text-white/30 mt-1">Exceptions: {kpis.total_exceptions} ({kpis.exception_rate}%)</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter size={14} className="text-white/50" />
        <select className="bg-surface border border-white/10 rounded px-2 py-1 text-xs" value={historyFilter.status || ''} onChange={e => { setHistoryFilter(f => ({ ...f, status: e.target.value || undefined })); setHistoryPage(0); }}>
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        <select className="bg-surface border border-white/10 rounded px-2 py-1 text-xs" value={historyFilter.triggered_by || ''} onChange={e => { setHistoryFilter(f => ({ ...f, triggered_by: e.target.value || undefined })); setHistoryPage(0); }}>
          <option value="">All Triggers</option>
          <option value="manual">Manual</option>
          <option value="schedule">Schedule</option>
          <option value="retry">Retry</option>
          <option value="api">API</option>
        </select>
        <input type="date" className="bg-surface border border-white/10 rounded px-2 py-1 text-xs" placeholder="From" value={historyFilter.from || ''} onChange={e => { setHistoryFilter(f => ({ ...f, from: e.target.value || undefined })); setHistoryPage(0); }} />
        <input type="date" className="bg-surface border border-white/10 rounded px-2 py-1 text-xs" placeholder="To" value={historyFilter.to || ''} onChange={e => { setHistoryFilter(f => ({ ...f, to: e.target.value || undefined })); setHistoryPage(0); }} />
        <span className="text-xs text-white/40 ml-auto">{runsTotal} runs</span>
      </div>

      {runsLoading ? (
        <div className="flex items-center gap-2 p-6 justify-center"><Loader2 size={16} className="animate-spin" /> Loading...</div>
      ) : runs.length === 0 ? (
        <div className="text-center text-white/50 p-6">No runs found.</div>
      ) : (
        <div className="space-y-2">
          {runs.map(run => (
            <Card key={run.id} className="p-3 bg-surface border-white/5 hover:border-accent/30 cursor-pointer transition-colors" onClick={() => loadRunDetail(run.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {runStatusIcon(run.status)}
                  <span className="font-medium text-sm">Run #{run.run_number}</span>
                  <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'} className="text-xs">{run.status}</Badge>
                  <span className="text-xs text-white/40">{run.triggered_by}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-white/50">
                  <span>{fmtDuration(run.duration_ms)}</span>
                  <span>{fmtDate(run.started_at)}</span>
                </div>
              </div>
              <div className="flex gap-4 mt-2 text-xs">
                <span className="text-emerald-400">{run.matched} matched</span>
                <span className="text-amber-400">{run.discrepancies} discrepancies</span>
                <span className="text-red-400">{run.exceptions_raised} exceptions</span>
                <span className="text-white/40">{run.unmatched_source + (run.unmatched_target || 0)} unmatched</span>
                {run.total_source_value > 0 && <span className="text-white/50 ml-auto">{fmtCurrency(run.total_source_value, run.currency)}</span>}
              </div>
              {/* Review + Sign-off indicators */}
              <div className="flex gap-2 mt-1">
                {run.items_total > 0 && (
                  <span className="text-xs text-white/30">
                    Review: {run.items_reviewed}/{run.items_total}
                    {run.review_complete ? <CheckCircle size={10} className="inline ml-1 text-emerald-400" /> : null}
                  </span>
                )}
                {run.sign_off_status !== 'open' && (
                  <Badge variant={run.sign_off_status === 'signed_off' ? 'success' : 'warning'} className="text-xs">{run.sign_off_status}</Badge>
                )}
              </div>
            </Card>
          ))}
          {/* Pagination */}
          {runsTotal > 20 && (
            <div className="flex justify-center gap-2 mt-2">
              <Button size="sm" variant="ghost" disabled={historyPage === 0} onClick={() => { setHistoryPage(p => p - 1); loadRuns(historyPage - 1); }}>Prev</Button>
              <span className="text-xs text-white/50 py-1">Page {historyPage + 1} of {Math.ceil(runsTotal / 20)}</span>
              <Button size="sm" variant="ghost" disabled={(historyPage + 1) * 20 >= runsTotal} onClick={() => { setHistoryPage(p => p + 1); loadRuns(historyPage + 1); }}>Next</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderDetail = () => {
    if (detailLoading) return <div className="flex items-center gap-2 p-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading run detail...</div>;
    if (!selectedRun) return <div className="text-center text-white/50 p-8">Select a run from the History tab to view details.</div>;

    const run = selectedRun.run;
    return (
      <div className="space-y-4">
        {/* Run header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {runStatusIcon(run.status)}
            <span className="font-semibold">Run #{run.run_number}</span>
            <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>{run.status}</Badge>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={handleRetry}><RotateCcw size={14} className="mr-1" />Retry</Button>
            <a href={`${API_URL}/api/catalysts/runs/${run.id}/export`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost"><Download size={14} className="mr-1" />Export CSV</Button>
            </a>
          </div>
        </div>

        {/* Financial Summary */}
        <Card className="p-3 bg-surface border-white/5">
          <div className="text-xs font-medium text-white/60 mb-2">Financial Summary ({run.currency})</div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
            <div><span className="text-white/40">Source Value:</span> <span className="font-medium">{fmtCurrency(run.total_source_value, run.currency)}</span></div>
            <div><span className="text-white/40">Matched:</span> <span className="font-medium text-emerald-400">{fmtCurrency(run.total_matched_value, run.currency)}</span></div>
            <div><span className="text-white/40">Discrepancy:</span> <span className="font-medium text-amber-400">{fmtCurrency(run.total_discrepancy_value, run.currency)}</span></div>
            <div><span className="text-white/40">Exception:</span> <span className="font-medium text-red-400">{fmtCurrency(run.total_exception_value, run.currency)}</span></div>
            <div><span className="text-white/40">Unmatched:</span> <span className="font-medium text-white/50">{fmtCurrency(run.total_unmatched_value, run.currency)}</span></div>
          </div>
        </Card>

        {/* Step Timeline */}
        {selectedRun.steps.length > 0 && (
          <Card className="p-3 bg-surface border-white/5">
            <div className="text-xs font-medium text-white/60 mb-2">Execution Steps</div>
            <div className="space-y-1">
              {selectedRun.steps.map(step => (
                <div key={step.step} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-white/30">{step.step}.</span>
                  {step.status === 'completed' ? <CheckCircle size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
                  <span className="flex-1">{step.name}</span>
                  <span className="text-white/40">{fmtDuration(step.duration_ms)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Linked Outputs */}
        {(selectedRun.linkedOutputs.metrics.length > 0 || selectedRun.linkedOutputs.anomalies.length > 0 || selectedRun.linkedOutputs.risk_alerts.length > 0 || selectedRun.linkedOutputs.actions.length > 0) && (
          <Card className="p-3 bg-surface border-white/5">
            <div className="text-xs font-medium text-white/60 mb-2">Linked Outputs</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {selectedRun.linkedOutputs.metrics.map(m => <Badge key={m} variant="info" className="text-xs">Metric: {m.substring(0, 12)}...</Badge>)}
              {selectedRun.linkedOutputs.anomalies.map(a => <Badge key={a} variant="warning" className="text-xs">Anomaly: {a.substring(0, 12)}...</Badge>)}
              {selectedRun.linkedOutputs.risk_alerts.map(r => <Badge key={r} variant="danger" className="text-xs">Risk: {r.substring(0, 12)}...</Badge>)}
              {selectedRun.linkedOutputs.actions.map(a => <Badge key={a} variant="success" className="text-xs">Action: {a.substring(0, 12)}...</Badge>)}
            </div>
          </Card>
        )}

        {/* Run Comparison */}
        <Card className="p-3 bg-surface border-white/5">
          <div className="text-xs font-medium text-white/60 mb-2">Compare with Another Run</div>
          <div className="flex gap-2 items-center">
            <select className="bg-surface border border-white/10 rounded px-2 py-1 text-xs flex-1" value={compareRunId || ''} onChange={e => e.target.value && handleCompare(e.target.value)}>
              <option value="">Select run to compare...</option>
              {runs.filter(r => r.id !== run.id).map(r => <option key={r.id} value={r.id}>Run #{r.run_number} ({r.status}) - {fmtDate(r.started_at)}</option>)}
            </select>
          </div>
          {comparison && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-white/40">Delta:</div>
                <div>Matched: <span className={comparison.delta.matched >= 0 ? 'text-emerald-400' : 'text-red-400'}>{comparison.delta.matched >= 0 ? '+' : ''}{comparison.delta.matched}</span></div>
                <div>Discrepancies: <span className={comparison.delta.discrepancies <= 0 ? 'text-emerald-400' : 'text-red-400'}>{comparison.delta.discrepancies >= 0 ? '+' : ''}{comparison.delta.discrepancies}</span></div>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-400">{comparison.resolved_discrepancies.length} resolved</span>
                <span className="text-red-400">{comparison.new_discrepancies.length} new</span>
                <span className="text-white/40">{comparison.persistent_discrepancies.length} persistent</span>
              </div>
            </div>
          )}
        </Card>

        {/* Items Table */}
        <Card className="p-3 bg-surface border-white/5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-white/60">Transaction Items</div>
            <div className="flex gap-2">
              <select className="bg-surface border border-white/10 rounded px-2 py-1 text-xs" value={itemFilter.status || ''} onChange={e => { setItemFilter(f => ({ ...f, status: e.target.value || undefined })); handleLoadItems(0); }}>
                <option value="">All Status</option>
                <option value="matched">Matched</option>
                <option value="discrepancy">Discrepancy</option>
                <option value="unmatched_source">Unmatched Source</option>
                <option value="unmatched_target">Unmatched Target</option>
                <option value="exception">Exception</option>
              </select>
              <select className="bg-surface border border-white/10 rounded px-2 py-1 text-xs" value={itemFilter.review_status || ''} onChange={e => { setItemFilter(f => ({ ...f, review_status: e.target.value || undefined })); handleLoadItems(0); }}>
                <option value="">All Review</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="deferred">Deferred</option>
              </select>
            </div>
          </div>

          {/* Review progress bar */}
          {items && items.review_progress && (
            <div className="mb-2">
              <div className="flex justify-between text-xs text-white/40 mb-1">
                <span>Review Progress</span>
                <span>{items.review_progress.reviewed + items.review_progress.pending > 0 ? Math.round((items.review_progress.reviewed / (items.review_progress.reviewed + items.review_progress.pending)) * 100) : 0}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                <div className="bg-emerald-400 h-full" style={{ width: `${items.total ? (items.review_progress.approved / items.total) * 100 : 0}%` }} />
                <div className="bg-red-400 h-full" style={{ width: `${items.total ? (items.review_progress.rejected / items.total) * 100 : 0}%` }} />
                <div className="bg-amber-400 h-full" style={{ width: `${items.total ? (items.review_progress.deferred / items.total) * 100 : 0}%` }} />
              </div>
              <div className="flex gap-3 text-xs text-white/30 mt-1">
                <span className="text-emerald-400">{items.review_progress.approved} approved</span>
                <span className="text-red-400">{items.review_progress.rejected} rejected</span>
                <span className="text-amber-400">{items.review_progress.deferred} deferred</span>
                <span>{items.review_progress.pending} pending</span>
              </div>
            </div>
          )}

          {/* Bulk review actions */}
          {selectedItemIds.size > 0 && (
            <div className="flex gap-2 items-center mb-2 p-2 bg-accent/5 rounded">
              <span className="text-xs">{selectedItemIds.size} selected</span>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => handleBulkReview('approved')}><ThumbsUp size={12} className="mr-1" />Approve</Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => handleBulkReview('rejected')}><ThumbsDown size={12} className="mr-1" />Reject</Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => handleBulkReview('deferred')}>Defer</Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedItemIds(new Set())}>Clear</Button>
            </div>
          )}

          {itemsLoading ? (
            <div className="flex items-center gap-2 p-4 justify-center"><Loader2 size={14} className="animate-spin" /> Loading items...</div>
          ) : !items || items.items.length === 0 ? (
            <div className="text-center text-white/40 p-4 text-xs">No items found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/40 border-b border-white/5">
                    <th className="p-1 text-left w-6"><input type="checkbox" onChange={e => { if (e.target.checked) setSelectedItemIds(new Set(items.items.map(i => i.id))); else setSelectedItemIds(new Set()); }} /></th>
                    <th className="p-1 text-left">#</th>
                    <th className="p-1 text-left">Status</th>
                    <th className="p-1 text-left">Source Ref</th>
                    <th className="p-1 text-right">Source Amt</th>
                    <th className="p-1 text-left">Target Ref</th>
                    <th className="p-1 text-right">Target Amt</th>
                    <th className="p-1 text-right">Confidence</th>
                    <th className="p-1 text-left">Discrepancy</th>
                    <th className="p-1 text-left">Review</th>
                    <th className="p-1 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.items.map(item => (
                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-1"><input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={e => { const next = new Set(selectedItemIds); if (e.target.checked) next.add(item.id); else next.delete(item.id); setSelectedItemIds(next); }} /></td>
                      <td className="p-1 text-white/40">{item.item_number}</td>
                      <td className="p-1">
                        <Badge variant={item.item_status === 'matched' ? 'success' : item.item_status === 'discrepancy' ? 'warning' : item.item_status === 'exception' ? 'danger' : 'info'} className="text-xs">
                          {item.item_status}
                        </Badge>
                      </td>
                      <td className="p-1">{item.source_ref || '-'}</td>
                      <td className="p-1 text-right">{item.source_amount?.toFixed(2) || '-'}</td>
                      <td className="p-1">{item.target_ref || '-'}</td>
                      <td className="p-1 text-right">{item.target_amount?.toFixed(2) || '-'}</td>
                      <td className="p-1 text-right">{item.match_confidence ? `${(item.match_confidence * 100).toFixed(0)}%` : '-'}</td>
                      <td className="p-1">
                        {item.discrepancy_amount ? (
                          <span className="text-amber-400">{item.discrepancy_amount.toFixed(2)} ({item.discrepancy_pct?.toFixed(1)}%)</span>
                        ) : item.exception_type ? (
                          <span className="text-red-400">{item.exception_type}</span>
                        ) : '-'}
                      </td>
                      <td className="p-1">
                        <Badge variant={item.review_status === 'approved' ? 'success' : item.review_status === 'rejected' ? 'danger' : item.review_status === 'deferred' ? 'warning' : 'info'} className="text-xs">
                          {item.review_status}
                        </Badge>
                      </td>
                      <td className="p-1">
                        {item.review_status === 'pending' && (
                          <div className="flex gap-1">
                            <button className="text-emerald-400 hover:text-emerald-300" onClick={() => handleReview(item.id, 'approved')} title="Approve"><ThumbsUp size={12} /></button>
                            <button className="text-red-400 hover:text-red-300" onClick={() => handleReview(item.id, 'rejected')} title="Reject"><ThumbsDown size={12} /></button>
                            <button className="text-white/40 hover:text-white/60" onClick={() => handleReview(item.id, 'deferred')} title="Defer"><Clock size={12} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Items pagination */}
              {items.total > 50 && (
                <div className="flex justify-center gap-2 mt-2">
                  <Button size="sm" variant="ghost" disabled={itemPage === 0} onClick={() => handleLoadItems(itemPage - 1)}>Prev</Button>
                  <span className="text-xs text-white/50 py-1">Page {itemPage + 1} of {Math.ceil(items.total / 50)}</span>
                  <Button size="sm" variant="ghost" disabled={(itemPage + 1) * 50 >= items.total} onClick={() => handleLoadItems(itemPage + 1)}>Next</Button>
                </div>
              )}
            </div>
          )}

          {/* Financial totals summary */}
          {items && items.totals && (
            <div className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs border-t border-white/5 pt-2">
              <div><span className="text-white/40">Total Items:</span> {items.totals.items_total}</div>
              <div><span className="text-white/40">Matched:</span> <span className="text-emerald-400">{items.totals.matched}</span></div>
              <div><span className="text-white/40">Discrepancies:</span> <span className="text-amber-400">{items.totals.discrepancies}</span></div>
              <div><span className="text-white/40">Exceptions:</span> <span className="text-red-400">{items.totals.exceptions}</span></div>
            </div>
          )}
        </Card>

        {/* Sign-off */}
        <Card className="p-3 bg-surface border-white/5">
          <div className="text-xs font-medium text-white/60 mb-2">Sign-off</div>
          {run.sign_off_status === 'signed_off' ? (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle size={14} className="text-emerald-400" />
              <span>Signed off by {run.signed_off_by} on {fmtDate(run.signed_off_at)}</span>
              {run.sign_off_notes && <span className="text-white/40">- {run.sign_off_notes}</span>}
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <input type="text" className="bg-surface border border-white/10 rounded px-2 py-1 text-xs flex-1" placeholder="Sign-off notes..." value={signOffNotes} onChange={e => setSignOffNotes(e.target.value)} />
              <Button size="sm" variant="ghost" className="text-emerald-400 text-xs" onClick={() => handleSignOff('signed_off')}><FileCheck size={12} className="mr-1" />Sign Off</Button>
              <Button size="sm" variant="ghost" className="text-red-400 text-xs" onClick={() => handleSignOff('rejected')}>Reject</Button>
              <Button size="sm" variant="ghost" className="text-amber-400 text-xs" onClick={() => handleSignOff('deferred')}>Defer</Button>
            </div>
          )}
        </Card>

        {/* Comments */}
        <Card className="p-3 bg-surface border-white/5">
          <div className="text-xs font-medium text-white/60 mb-2">Comments ({comments.length})</div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {comments.map(c => (
              <div key={c.id} className="text-xs border-b border-white/5 pb-1">
                <span className="font-medium">{c.user_name}</span>
                <span className="text-white/30 ml-2">{fmtDate(c.created_at)}</span>
                <p className="text-white/70 mt-0.5">{c.comment}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input type="text" className="bg-surface border border-white/10 rounded px-2 py-1 text-xs flex-1" placeholder="Add a comment..." value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddComment()} />
            <Button size="sm" variant="ghost" onClick={handleAddComment}><Send size={12} /></Button>
          </div>
        </Card>

        {/* Reasoning */}
        {run.reasoning && (
          <Card className="p-3 bg-surface border-white/5">
            <div className="text-xs font-medium text-white/60 mb-1">AI Reasoning</div>
            <p className="text-xs text-white/70">{run.reasoning}</p>
          </Card>
        )}
      </div>
    );
  };

  const renderConfig = () => (
    <div className="space-y-4">
      <Card className="p-4 bg-surface border-white/5">
        <div className="text-sm font-medium text-white/80 mb-3">KPI Thresholds</div>
        <p className="text-xs text-white/40 mb-4">Configure the Green / Amber / Red threshold zones for each KPI metric.</p>

        {/* Success Rate thresholds */}
        <div className="mb-4">
          <div className="text-xs font-medium text-white/60 mb-2">Success Rate (%)</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-emerald-400 block mb-1">Green &ge;</label>
              <input type="number" className="bg-surface border border-emerald-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_success_green || 90} onChange={e => setThresholds(t => ({ ...t, threshold_success_green: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-amber-400 block mb-1">Amber &ge;</label>
              <input type="number" className="bg-surface border border-amber-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_success_amber || 70} onChange={e => setThresholds(t => ({ ...t, threshold_success_amber: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-red-400 block mb-1">Red &lt;</label>
              <input type="number" className="bg-surface border border-red-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_success_red || 50} onChange={e => setThresholds(t => ({ ...t, threshold_success_red: parseFloat(e.target.value) }))} />
            </div>
          </div>
        </div>

        {/* Duration thresholds */}
        <div className="mb-4">
          <div className="text-xs font-medium text-white/60 mb-2">Duration (ms)</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-emerald-400 block mb-1">Green &le;</label>
              <input type="number" className="bg-surface border border-emerald-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_duration_green || 60000} onChange={e => setThresholds(t => ({ ...t, threshold_duration_green: parseInt(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-amber-400 block mb-1">Amber &le;</label>
              <input type="number" className="bg-surface border border-amber-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_duration_amber || 120000} onChange={e => setThresholds(t => ({ ...t, threshold_duration_amber: parseInt(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-red-400 block mb-1">Red &gt;</label>
              <input type="number" className="bg-surface border border-red-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_duration_red || 300000} onChange={e => setThresholds(t => ({ ...t, threshold_duration_red: parseInt(e.target.value) }))} />
            </div>
          </div>
        </div>

        {/* Discrepancy Rate thresholds */}
        <div className="mb-4">
          <div className="text-xs font-medium text-white/60 mb-2">Discrepancy Rate (%)</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-emerald-400 block mb-1">Green &le;</label>
              <input type="number" className="bg-surface border border-emerald-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_discrepancy_green || 2} onChange={e => setThresholds(t => ({ ...t, threshold_discrepancy_green: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-amber-400 block mb-1">Amber &le;</label>
              <input type="number" className="bg-surface border border-amber-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_discrepancy_amber || 5} onChange={e => setThresholds(t => ({ ...t, threshold_discrepancy_amber: parseFloat(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-red-400 block mb-1">Red &gt;</label>
              <input type="number" className="bg-surface border border-red-400/30 rounded px-2 py-1 text-xs w-full" value={thresholds.threshold_discrepancy_red || 10} onChange={e => setThresholds(t => ({ ...t, threshold_discrepancy_red: parseFloat(e.target.value) }))} />
            </div>
          </div>
        </div>

        <Button size="sm" onClick={handleSaveThresholds} disabled={savingThresholds}>
          {savingThresholds ? <Loader2 size={14} className="animate-spin mr-1" /> : <Settings size={14} className="mr-1" />}
          Save Thresholds
        </Button>
      </Card>
    </div>
  );

  const tabItems = [
    { id: 'overview' as TabId, label: 'Overview', icon: <Activity size={14} /> },
    { id: 'history' as TabId, label: 'Run History', icon: <Clock size={14} /> },
    { id: 'detail' as TabId, label: 'Run Detail', icon: <Eye size={14} /> },
    { id: 'config' as TabId, label: 'Configuration', icon: <Settings size={14} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex justify-end">
      <div className="w-full max-w-4xl bg-background border-l border-white/10 flex flex-col overflow-hidden animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="font-semibold text-sm">{subCatalystName}</h2>
            <p className="text-xs text-white/40">{clusterName}</p>
          </div>
          <div className="flex items-center gap-2">
            {kpis && (
              <div className={`w-2.5 h-2.5 rounded-full ${kpis.status === 'green' ? 'bg-emerald-400' : kpis.status === 'amber' ? 'bg-amber-400' : 'bg-red-400'}`} />
            )}
            <Button size="sm" variant="ghost" onClick={onClose}><X size={16} /></Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-white/10 px-4">
          {tabItems.map(t => (
            <button
              key={t.id}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-white/50 hover:text-white/70'}`}
              onClick={() => { setTab(t.id); if (t.id === 'history') loadRuns(historyPage); }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'overview' && renderOverview()}
          {tab === 'history' && renderHistory()}
          {tab === 'detail' && renderDetail()}
          {tab === 'config' && renderConfig()}
        </div>
      </div>
    </div>
  );
}
