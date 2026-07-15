import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/state";
import { AsyncPageContent, statusFrom } from "@/components/ui/async";
import { useParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { Numeric } from "@/components/ui/numeric";
import { MetricSource, type MetricProvenance } from "@/components/ui/metric-source";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type {
  SubCatalystRunItem,
  SubCatalystRunItemsResponse,
  RunComment,
  SubCatalystRun,
  SubCatalystRunDetail,
  SubCatalystRunComparison,
} from "@/lib/api";
import { useToast, type ToastApi } from "@/components/ui/toast";
import { useAppStore } from "@/stores/appStore";
import { CatalystSimulatorCard } from "@/components/CatalystSimulatorCard";
import {
  RunItemsFilterBar,
  type ItemStatus,
  type ReviewStatus,
  type Severity,
} from "@/components/RunItemsFilterBar";
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle,
  Activity, Database, BarChart3, Download, FileText,
  ThumbsUp, ThumbsDown, MessageCircle, Send, Loader2, Trash2,
  RotateCcw, GitCompare, GitBranch, Lightbulb, ChevronUp,
} from "lucide-react";

const ADMIN_ROLES = new Set(['superadmin', 'support_admin', 'admin', 'executive']);


interface RunDetail {
  id: string;
  clusterId?: string;
  subCatalystName: string;
  clusterName: string;
  clusterDomain: string;
  status: string;
  matched: number;
  discrepancies: number;
  exceptions: number;
  totalValue: number;
  startedAt: string;
  completedAt: string;
  kpis: Array<{ name: string; value: number; status: string; unit: string; target: number }>;
  metrics: Array<{ id: string; name: string; value: number; unit: string; status: string }>;
  sourceData: Array<{ id: string; sourceSystem: string; recordType: string; value: number; status: string }>;
}

// Rand formatter that never fabricates: non-numeric API values render as em-dash.
function zar(n: unknown): string {
  return typeof n === 'number' ? `R ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
}

// CSV-safe cell (mirrors AuditPage.csvSafe: prevents formula injection).
function csvSafe(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const s = String(val).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(s)) return `"'${s}"`;
  return `"${s}"`;
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Confirm dialog — uses the canonical Modal primitive so this page no
// longer reinvents overlay / ESC / scroll-lock / aria-modal mechanics.
function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', confirmVariant = 'primary',
  onConfirm, onCancel, busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} size="sm" dismissible={!busy}>
      <Modal.Header
        title={title}
        // Inline X is suppressed while the mutation is in flight via the
        // Modal's `dismissible` prop above; no need to disable here too.
        onClose={onCancel}
      />
      <Modal.Body>
        <p className="text-body-sm t-muted">{message}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          variant={confirmVariant === 'danger' ? 'ghost' : 'primary'}
          className={confirmVariant === 'danger' ? undefined : undefined}
          style={confirmVariant === 'danger' ? { color: 'var(--neg)' } : undefined}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export function CatalystRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  // `useToast()` returns a freshly-constructed object on every render (its
  // helper methods close over the provider's addToast). Including `toast` in
  // any useCallback dep array therefore invalidates the callback on every
  // render, which — when those callbacks feed a useEffect — triggers an
  // infinite load loop (see #re-render-loop). Stash the API in a ref so we
  // can call the latest version without destabilising memoised callbacks.
  const toastRef = useRef<ToastApi>(toast);
  toastRef.current = toast;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; requestId: string | null } | null>(null);

  // Items (server-paginated, client-filtered on top)
  const [items, setItems] = useState<SubCatalystRunItemsResponse | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemPage, setItemPage] = useState(0);

  // Client-side filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ItemStatus[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus[]>([]);
  const [severityFilter, setSeverityFilter] = useState<Severity[]>([]);

  // Approval workflow state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const [confirm, setConfirm] = useState<null | {
    kind: 'single' | 'bulk';
    action: ReviewStatus;
    itemId?: string;
    count: number;
  }>(null);

  // Comments
  const [comments, setComments] = useState<RunComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const currentUser = useAppStore((s) => s.user);
  const canDeleteComment = useCallback(
    (comment: RunComment) =>
      !!currentUser &&
      (comment.user_id === currentUser.id || ADMIN_ROLES.has(currentUser.role)),
    [currentUser],
  );

  // Export state
  const [exporting, setExporting] = useState(false);

  // Retry / compare / lineage / insights — production hardening
  const [runMeta, setRunMeta] = useState<SubCatalystRun | null>(null);
  const [runSteps, setRunSteps] = useState<SubCatalystRunDetail['steps']>([]);
  const [retrying, setRetrying] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<SubCatalystRunComparison | null>(null);
  const [compareExpanded, setCompareExpanded] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [lineage, setLineage] = useState<SubCatalystRun[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const loadRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.catalysts.runDetail(runId);
      setRun(data);
    } catch (err) {
      console.error('Failed to load run details:', err);
      const message = err instanceof Error ? err.message : 'Failed to load run details';
      const requestId = err instanceof ApiError ? err.requestId : null;
      setLoadError({ message, requestId });
      toastRef.current.error('Failed to load run', { message, requestId });
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const loadItems = useCallback(async (page = 0) => {
    if (!runId) return;
    setItemsLoading(true);
    setItemsError(null);
    try {
      const res = await api.catalysts.getRunItems(runId, { limit: 50, offset: page * 50 });
      setItems(res);
      setItemPage(page);
    } catch (err) {
      console.error('Failed to load run items:', err);
      const message = err instanceof Error ? err.message : 'Failed to load items';
      const requestId = err instanceof ApiError ? err.requestId : null;
      setItemsError(message);
      toastRef.current.error('Failed to load items', { message, requestId });
    } finally {
      setItemsLoading(false);
    }
  }, [runId]);

  const loadComments = useCallback(async () => {
    if (!runId) return;
    setCommentsLoading(true);
    try {
      const res = await api.catalysts.getRunComments(runId);
      setComments(res.comments);
    } catch (err) {
      console.error('Failed to load comments:', err);
      const message = err instanceof Error ? err.message : 'Failed to load comments';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toastRef.current.error('Failed to load comments', { message, requestId });
    } finally {
      setCommentsLoading(false);
    }
  }, [runId]);

  // Load the SubCatalystRun row (carries parent_run_id, which the
  // `runDetail()` projection drops). Walked backward to render lineage.
  const loadRunMetaAndLineage = useCallback(async (clusterId: string, subName: string, currentRunId: string) => {
    try {
      const detail = await api.catalysts.getSubCatalystRunDetail(clusterId, subName, currentRunId);
      setRunMeta(detail.run);
      setRunSteps(detail.steps ?? []);

      // Walk parent_run_id backward, max 5 ancestors.
      const chain: SubCatalystRun[] = [];
      let cursor = detail.run.parent_run_id;
      let safety = 0;
      while (cursor && safety < 5) {
        try {
          const parentDetail = await api.catalysts.getSubCatalystRunDetail(clusterId, subName, cursor);
          chain.push(parentDetail.run);
          cursor = parentDetail.run.parent_run_id;
        } catch {
          break;
        }
        safety += 1;
      }
      setLineage(chain);
    } catch (err) {
      // Non-fatal — page still works without retry/compare/lineage.
      console.warn('Failed to load run meta for lineage:', err);
    }
  }, []);

  const loadInsights = useCallback(async () => {
    if (!runId) return;
    setInsightsLoading(true);
    try {
      const res = await api.catalysts.runAnalyticsDetail(runId);
      setInsights(res.analytics?.insights ?? []);
    } catch (err) {
      // Run-analytics row may not exist for every run; treat as empty.
      console.warn('Failed to load run analytics:', err);
      setInsights([]);
    } finally {
      setInsightsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    loadRun();
    loadItems(0);
    loadComments();
    loadInsights();
  }, [runId, loadRun, loadItems, loadComments, loadInsights]);

  // Once base run is loaded we know clusterId + subCatalystName — fetch
  // the SubCatalystRun row (parent_run_id) and walk lineage backward.
  useEffect(() => {
    if (!run?.clusterId || !run?.subCatalystName || !runId) return;
    void loadRunMetaAndLineage(run.clusterId, run.subCatalystName, runId);
  }, [run?.clusterId, run?.subCatalystName, runId, loadRunMetaAndLineage]);

  // ─ Retry ─
  const handleRetryRun = useCallback(async () => {
    if (!runId) return;
    setRetrying(true);
    try {
      const res = await api.catalysts.retryRun(runId);
      // The worker route doesn't echo the new run id, so we refresh in
      // place; the user can navigate via the cluster's run list if needed.
      toastRef.current.success('Retry queued', 'A new run has been spawned from this one');
      // If a redirect target were present we'd nav to it; today we refresh.
      if ((res as { run_id?: string }).run_id) {
        navigate(`/catalysts/runs/${(res as { run_id?: string }).run_id}`);
      } else {
        await Promise.all([loadRun(), loadItems(0), loadInsights()]);
      }
    } catch (err) {
      console.error('Retry failed:', err);
      const message = err instanceof Error ? err.message : 'Retry failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toastRef.current.error('Retry failed', { message, requestId });
    } finally {
      setRetrying(false);
    }
  }, [runId, loadRun, loadItems, loadInsights, navigate]);

  // ─ Compare ─
  // Resolve the run to compare against: prefer parent_run_id, else most
  // recent prior run on the same cluster/sub-catalyst.
  const resolvePriorRunId = useCallback(async (): Promise<string | null> => {
    if (!runMeta) return null;
    if (runMeta.parent_run_id) return runMeta.parent_run_id;
    if (!run?.clusterId || !run?.subCatalystName) return null;
    try {
      const { runs } = await api.catalysts.getSubCatalystRuns(run.clusterId, run.subCatalystName, { limit: 25 });
      const startedAt = new Date(runMeta.started_at ?? run.startedAt).getTime();
      const prior = runs
        .filter((r) => r.id !== runMeta.id)
        .filter((r) => new Date(r.started_at).getTime() < startedAt)
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      return prior[0]?.id ?? null;
    } catch (err) {
      console.warn('Failed to resolve prior run:', err);
      return null;
    }
  }, [runMeta, run?.clusterId, run?.subCatalystName, run?.startedAt]);

  const handleCompare = useCallback(async () => {
    if (!runId) return;
    setComparing(true);
    setCompareError(null);
    try {
      const priorId = await resolvePriorRunId();
      if (!priorId) {
        setCompareError('No prior run available to compare against');
        setCompareExpanded(true);
        return;
      }
      const res = await api.catalysts.compareRuns(runId, priorId);
      setComparison(res);
      setCompareExpanded(true);
    } catch (err) {
      console.error('Compare failed:', err);
      const message = err instanceof Error ? err.message : 'Compare failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toastRef.current.error('Compare failed', { message, requestId });
      setCompareError(message);
      setCompareExpanded(true);
    } finally {
      setComparing(false);
    }
  }, [runId, resolvePriorRunId]);

  // Derived: do we have any prior to compare against? Used to disable
  // the button up-front instead of failing on click.
  const canCompare = useMemo(() => {
    if (!runMeta) return true; // unknown — let the click resolve it
    if (runMeta.parent_run_id) return true;
    return true; // fall through to runs list at click time
  }, [runMeta]);

  // ─ Client-side filtered items (for search, multi-status, severity) ─
  const filteredItems = useMemo(() => {
    const base = items?.items ?? [];
    const q = searchQuery.trim().toLowerCase();
    return base.filter((it) => {
      if (q) {
        const hay = [
          it.source_ref, it.target_ref, it.source_entity, it.target_entity,
          it.discrepancy_reason, it.discrepancy_field, it.exception_type,
          it.exception_detail, it.category, String(it.item_number),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter.length > 0 && !statusFilter.includes(it.item_status as ItemStatus)) return false;
      if (reviewFilter.length > 0 && !reviewFilter.includes(it.review_status as ReviewStatus)) return false;
      if (severityFilter.length > 0) {
        if (!it.exception_severity) return false;
        if (!severityFilter.includes(it.exception_severity as Severity)) return false;
      }
      return true;
    });
  }, [items, searchQuery, statusFilter, reviewFilter, severityFilter]);

  // ─ Approval handlers ─
  const askReview = (action: ReviewStatus, itemId?: string) => {
    if (itemId) {
      setConfirm({ kind: 'single', action, itemId, count: 1 });
    } else {
      setConfirm({ kind: 'bulk', action, count: selectedItemIds.size });
    }
  };

  const doReview = async () => {
    if (!confirm || !runId) return;
    const { kind, action, itemId } = confirm;
    try {
      if (kind === 'single' && itemId) {
        setReviewingId(itemId);
        const res = await api.catalysts.reviewRunItem(runId, itemId, { review_status: action });
        toast.success(`Item ${action}`, `Review status updated (${res.review_status})`);
      } else if (kind === 'bulk') {
        setBulkReviewing(true);
        const res = await api.catalysts.bulkReviewRunItems(runId, {
          item_ids: Array.from(selectedItemIds),
          review_status: action,
        });
        toast.success(`${res.updated} items ${action}`, 'Bulk review complete');
        setSelectedItemIds(new Set());
      }
      setConfirm(null);
      await loadItems(itemPage);
    } catch (err) {
      console.error('Review failed:', err);
      const message = err instanceof Error ? err.message : 'Review failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Review failed', { message, requestId });
    } finally {
      setReviewingId(null);
      setBulkReviewing(false);
    }
  };

  const handleAddComment = async () => {
    if (!runId || !newComment.trim()) return;
    setAddingComment(true);
    try {
      await api.catalysts.addRunComment(runId, { comment: newComment.trim() });
      setNewComment('');
      await loadComments();
      toast.success('Comment added');
    } catch (err) {
      console.error('Add comment failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to add comment';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Failed to add comment', { message, requestId });
    } finally {
      setAddingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!runId) return;
    setDeletingCommentId(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      await api.catalysts.deleteRunComment(runId, commentId);
      toast.success('Comment deleted');
    } catch (err) {
      console.error('Delete comment failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete comment';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Failed to delete comment', { message, requestId });
      await loadComments();
    } finally {
      setDeletingCommentId(null);
    }
  };

  // ─ Export ─
  const handleExportCsv = async () => {
    if (!runId) return;
    if (!items || items.items.length === 0) {
      toast.warning('Nothing to export', 'No items loaded for this run');
      return;
    }
    setExporting(true);
    try {
      // Export the full dataset by paging through the backend.
      const all: SubCatalystRunItem[] = [];
      const pageSize = 200;
      const total = items.total || items.items.length;
      for (let offset = 0; offset < total; offset += pageSize) {
        const res = await api.catalysts.getRunItems(runId, { limit: pageSize, offset });
        all.push(...res.items);
        if (res.items.length < pageSize) break;
      }
      const headers = [
        'item_number', 'item_status', 'category',
        'source_ref', 'source_entity', 'source_amount', 'source_currency', 'source_date',
        'target_ref', 'target_entity', 'target_amount', 'target_currency', 'target_date',
        'match_confidence', 'match_method',
        'discrepancy_field', 'discrepancy_amount', 'discrepancy_pct', 'discrepancy_reason',
        'exception_type', 'exception_severity', 'exception_detail',
        'review_status', 'reviewed_by', 'reviewed_at', 'review_notes', 'reclassified_to',
      ];
      const lines = [headers.join(',')];
      for (const it of all) {
        lines.push(headers.map((h) => csvSafe((it as unknown as Record<string, unknown>)[h])).join(','));
      }
      triggerDownload(lines.join('\n'), `catalyst-run-${runId}-items.csv`, 'text/csv');
      toast.success('CSV exported', `${all.length} item${all.length === 1 ? '' : 's'} downloaded`);
    } catch (err) {
      console.error('CSV export failed:', err);
      const message = err instanceof Error ? err.message : 'Export failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Export failed', { message, requestId });
    } finally {
      setExporting(false);
    }
  };

  const handleExportJson = async () => {
    if (!runId || !run) return;
    setExporting(true);
    try {
      const all: SubCatalystRunItem[] = [];
      const pageSize = 200;
      const total = items?.total ?? items?.items.length ?? 0;
      for (let offset = 0; offset < total; offset += pageSize) {
        const res = await api.catalysts.getRunItems(runId, { limit: pageSize, offset });
        all.push(...res.items);
        if (res.items.length < pageSize) break;
      }
      const payload = {
        run,
        totals: items?.totals,
        review_progress: items?.review_progress,
        items: all,
        exported_at: new Date().toISOString(),
      };
      triggerDownload(JSON.stringify(payload, null, 2), `catalyst-run-${runId}.json`, 'application/json');
      toast.success('JSON exported', `${all.length} item${all.length === 1 ? '' : 's'} downloaded`);
    } catch (err) {
      console.error('JSON export failed:', err);
      const message = err instanceof Error ? err.message : 'Export failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Export failed', { message, requestId });
    } finally {
      setExporting(false);
    }
  };

  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        onRetry={() => void loadRun()}
        errorTitle="Couldn't load fix run"
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--warning)' }} />
          <h2 className="text-xl font-semibold t-primary mb-2">Run Not Found</h2>
          <p className="text-sm t-muted mb-4">
            {loadError?.message || "The fix run you're looking for doesn't exist or you don't have access to it."}
          </p>
          {loadError?.requestId && (
            <p className="text-caption t-muted font-mono mb-4">Request ID: {loadError.requestId}</p>
          )}
          <div className="flex gap-2 justify-center">
            <Button variant="ghost" onClick={loadRun}>Retry</Button>
            <Button variant="primary" onClick={() => navigate('/catalysts')}>
              <ArrowLeft size={14} className="mr-2" /> Back to Catalysts
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((it) => selectedItemIds.has(it.id));
  const pendingSelectedCount = Array.from(selectedItemIds).filter((id) =>
    (items?.items ?? []).find((it) => it.id === id)?.review_status === 'pending'
  ).length;

  const isFailed = run.status === 'failed';

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="border-b border-[var(--border-card)] bg-[var(--bg-card-solid)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-5">
          {/* Back + eyebrow */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => navigate('/catalysts')}
              className="p-1.5 -ml-1.5 hover:bg-[var(--bg-secondary)] rounded-md transition-[background-color,color,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.92]"
              aria-label="Back to Catalysts"
            >
              <ArrowLeft size={18} className="t-muted" />
            </button>
            <span
              className="text-[10px] uppercase tracking-[0.18em] t-muted"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
            >
              Fix Run Detail
            </span>
          </div>

          {/* Title row + hero recovered value */}
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">
                  {run.subCatalystName}
                </h1>
                <StatusPill status={run.status === 'success' ? 'completed' : run.status} size="sm" />
              </div>
              <p className="text-body-sm t-muted mt-1">{run.clusterName}</p>
            </div>
            <div className="text-right shrink-0">
              <Numeric value={run.totalValue ?? null} unit="currency" compact size="xl" />
              <div
                className="text-[10px] uppercase tracking-[0.18em] t-muted mt-1"
                style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
              >
                Total Value in Run
              </div>
            </div>
          </div>

          {/* Execution steps — real per-step status/duration/detail from the
              API (SubCatalystRunDetail.steps). Hidden entirely when the API
              returns no step data; never inferred from run.status. */}
          {runSteps.length > 0 && (
            <div className="mt-6 flex items-center gap-0 overflow-x-auto pb-1">
              {runSteps.map((step, i) => {
                const done = step.status === 'success' || step.status === 'completed';
                const failed = step.status === 'failed' || step.status === 'error';
                return (
                  <div key={step.step} className="flex items-center shrink-0">
                    <div
                      className="flex flex-col items-center gap-2 px-1"
                      title={[step.detail, typeof step.duration_ms === 'number' ? `${step.duration_ms.toLocaleString()} ms` : null].filter(Boolean).join(' • ') || step.name}
                    >
                      <div
                        className="flex items-center justify-center w-7 h-7 rounded-full border-2 transition-colors"
                        style={
                          done
                            ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
                            : failed
                              ? { background: 'var(--neg)', borderColor: 'var(--neg)' }
                              : { background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }
                        }
                        aria-hidden
                      >
                        {done ? (
                          <CheckCircle2 size={14} style={{ color: 'var(--bg-card-solid)' }} />
                        ) : failed ? (
                          <XCircle size={14} style={{ color: 'var(--bg-card-solid)' }} />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
                        )}
                      </div>
                      <span
                        className="text-[10px] uppercase tracking-[0.14em]"
                        style={{
                          fontFamily: "'Space Mono', ui-monospace, monospace",
                          color: done ? 'var(--accent)' : failed ? 'var(--neg)' : 'var(--text-muted)',
                        }}
                      >
                        {step.name}
                      </span>
                    </div>
                    {i < runSteps.length - 1 && (
                      <div
                        className="h-0.5 w-16 sm:w-24 lg:w-32 -mt-5"
                        style={{ background: done ? 'var(--accent)' : 'var(--border-card)' }}
                        aria-hidden
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Action bar */}
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <div
              className="flex items-center gap-1.5 text-xs t-muted mr-1"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
            >
              <Clock size={13} />
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              {typeof runMeta?.source_record_count === 'number' && typeof runMeta?.target_record_count === 'number' && (
                <span title="ERP records this run read, from the source and target systems">
                  • {runMeta.source_record_count.toLocaleString()} source / {runMeta.target_record_count.toLocaleString()} target records
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                onClick={handleRetryRun}
                disabled={retrying || run.status === 'running'}
                title={run.status === 'running' ? 'Cannot retry a run that is still executing' : 'Spawn a new run from this one'}
              >
                {retrying ? <Loader2 size={14} className="animate-spin mr-2" /> : <RotateCcw size={14} className="mr-2" />}
                Retry run
              </Button>
              <Button
                variant="ghost"
                onClick={handleCompare}
                disabled={comparing || !canCompare}
                title="Compare against the previous run for this catalyst"
              >
                {comparing ? <Loader2 size={14} className="animate-spin mr-2" /> : <GitCompare size={14} className="mr-2" />}
                Compare to previous
              </Button>
              <Button variant="ghost" onClick={handleExportCsv} disabled={exporting || !items}>
                {exporting ? <Loader2 size={14} className="animate-spin mr-2" /> : <Download size={14} className="mr-2" />}
                Export CSV
              </Button>
              <Button variant="ghost" onClick={handleExportJson} disabled={exporting || !items}>
                <FileText size={14} className="mr-2" /> Export JSON
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Failed-run callout — status straight from the API; failure detail
            only shown when the API supplies it (runMeta.reasoning). */}
        {isFailed && (
          <Card className="p-4 mb-6" style={{ borderRadius: '2px', borderColor: 'rgb(var(--neg-rgb) / 0.4)' }}>
            <div className="flex items-start gap-2">
              <XCircle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--neg)' }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold t-primary">This fix run failed</p>
                <p className="text-sm t-muted mt-1 whitespace-pre-wrap">
                  {runMeta?.reasoning || 'The system did not return a failure reason for this run.'}
                </p>
                <p className="text-xs t-muted mt-2">
                  Use "Retry run" above to spawn a new run — this one stays linked to it via run lineage.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Run comparison — expanded after clicking "Compare to previous" */}
        {compareExpanded && (
          <Card className="p-5 mb-6" style={{ borderRadius: '2px' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <GitCompare className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-semibold t-primary tracking-tight">Run comparison</h3>
                {comparison && comparison.run_b && (
                  <span className="text-xs t-muted font-mono">
                    vs run #{comparison.run_b.run_number} • {new Date(comparison.run_b.started_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCompareExpanded(false)}
                className="t-muted hover:t-primary text-xs inline-flex items-center gap-1"
                aria-label="Collapse comparison"
              >
                <ChevronUp size={14} /> Hide
              </button>
            </div>

            {compareError ? (
              <p className="text-sm t-muted">{compareError}</p>
            ) : comparison ? (
              (() => {
                // Pull the four deltas the brief calls out. The worker
                // returns a Record<string, number>; we tolerate either
                // snake_case or camelCase since the field naming has
                // drifted across worker iterations.
                const d = comparison.delta || {};
                const pick = (...keys: string[]): number | null => {
                  for (const k of keys) {
                    if (typeof d[k] === 'number') return d[k];
                  }
                  return null;
                };
                const matchedDelta = pick('matched', 'items_matched', 'itemsMatched');
                const exceptionsDelta = pick('exceptions_raised', 'exceptions', 'exceptionsRaised');
                const totalValueDelta = pick('total_source_value', 'total_value', 'totalValue', 'totalSourceValue');
                const automationDelta = pick('automation_rate', 'automationRate');

                const a = comparison.run_a;
                const b = comparison.run_b;
                const automationRate = (r: SubCatalystRun | null) => {
                  if (!r || !r.items_total) return null;
                  return ((r.items_total - r.items_reviewed) / r.items_total) * 100;
                };

                type Row = { label: string; current: number | null; prior: number | null; delta: number | null; isPct?: boolean };
                const rows: Row[] = [
                  { label: 'Items matched', current: a?.matched ?? null, prior: b?.matched ?? null, delta: matchedDelta },
                  { label: 'Exceptions', current: a?.exceptions_raised ?? null, prior: b?.exceptions_raised ?? null, delta: exceptionsDelta },
                  { label: 'Total value', current: a?.total_source_value ?? null, prior: b?.total_source_value ?? null, delta: totalValueDelta },
                  { label: 'Automation rate', current: automationRate(a), prior: automationRate(b), delta: automationDelta, isPct: true },
                ];

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {rows.map((row) => {
                      // Direction colouring: more matched + automation = good;
                      // more exceptions = bad; total value is neutral.
                      const isExceptionsRow = row.label === 'Exceptions';
                      const isNeutralRow = row.label === 'Total value';
                      const deltaColor = row.delta == null
                        ? 'var(--text-muted)'
                        : isNeutralRow
                          ? 'var(--text-secondary)'
                          : (row.delta > 0)
                            ? (isExceptionsRow ? 'var(--neg)' : 'var(--accent)')
                            : row.delta < 0
                              ? (isExceptionsRow ? 'var(--accent)' : 'var(--neg)')
                              : 'var(--text-secondary)';
                      const fmt = (n: number | null) => {
                        if (n == null) return '—';
                        if (row.isPct) return `${n.toFixed(1)}%`;
                        return n.toLocaleString();
                      };
                      const fmtDelta = (n: number | null) => {
                        if (n == null) return '—';
                        const sign = n > 0 ? '+' : '';
                        if (row.isPct) return `${sign}${n.toFixed(1)} pts`;
                        return `${sign}${n.toLocaleString()}`;
                      };
                      return (
                        <div
                          key={row.label}
                          className="p-3 bg-[var(--bg-primary)] border border-[var(--border-card)]"
                          style={{ borderRadius: '2px' }}
                        >
                          <div className="text-caption uppercase tracking-wider t-muted mb-2" style={{ color: 'var(--text-secondary)' }}>{row.label}</div>
                          <div className="flex items-baseline justify-between gap-2">
                            <div>
                              <div className="text-xs t-muted">This run</div>
                              <div className="text-base font-semibold t-primary font-mono tnum">{fmt(row.current)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs t-muted">Prior</div>
                              <div className="text-sm t-muted font-mono tnum">{fmt(row.prior)}</div>
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-[var(--border-card)]">
                            <span className="text-xs font-mono tnum font-semibold" style={{ color: deltaColor }}>
                              {fmtDelta(row.delta)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            ) : (
              <div className="flex items-center gap-2 t-muted text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading comparison...
              </div>
            )}
          </Card>
        )}

        {/* Run lineage — chain of parent_run_id ancestors (current → oldest) */}
        {(runMeta?.parent_run_id || lineage.length > 0) && (
          <Card className="p-4 mb-6" style={{ borderRadius: '2px' }}>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h3 className="text-sm font-semibold t-primary tracking-tight">Run lineage</h3>
              <span className="text-xs t-muted">retried from prior runs</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Current run chip — non-clickable */}
              <span
                className="inline-flex items-center gap-2 px-2.5 py-1 border text-xs"
                style={{
                  borderRadius: '2px',
                  background: 'var(--bg-primary)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                }}
              >
                <span className="font-mono tnum">{new Date(run.startedAt).toLocaleDateString()}</span>
                <span className="t-muted">•</span>
                <span>{run.status}</span>
                <span className="text-caption uppercase tracking-wider opacity-70">current</span>
              </span>
              {lineage.map((ancestor) => (
                <div key={ancestor.id} className="flex items-center gap-2">
                  <span className="t-muted text-xs">←</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/catalysts/runs/${ancestor.id}`)}
                    className="inline-flex items-center gap-2 px-2.5 py-1 border text-xs hover:bg-[var(--bg-primary)] transition-colors"
                    style={{ borderRadius: '2px', borderColor: 'var(--border-card)', color: 'var(--text-secondary)' }}
                    aria-label={`View ancestor run from ${new Date(ancestor.started_at).toLocaleDateString()}`}
                  >
                    <span className="font-mono tnum">{new Date(ancestor.started_at).toLocaleDateString()}</span>
                    <span className="t-muted">•</span>
                    <span>{ancestor.status}</span>
                  </button>
                </div>
              ))}
              {runMeta?.parent_run_id && lineage.length === 0 && (
                <span className="text-xs t-muted">
                  <Loader2 size={12} className="animate-spin inline mr-1" /> Loading ancestors...
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Key Metrics */}
        {/* Run summary KPIs — Stitch bento. Same accent vocabulary as
            the Apex briefing tiles and the Operator Queue dispatch tiles:
            emerald success / amber discrepancy / red exception / sky value. */}
        {(() => {
          const runProvenance: Partial<MetricProvenance> = {
            endpoint: `GET /api/catalysts/runs/${runId}/detail`,
            table: 'sub_catalyst_runs',
            window: `Run started ${run.startedAt ?? ''}`,
            refreshedAt: run.completedAt ?? run.startedAt ?? null,
          };
          return (
        <div className="stagger grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-[var(--border-card)] hover:-translate-y-px transition-[border-color,transform] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.14em] t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Matched Records</span>
              <div className="flex items-center gap-1">
                <MetricSource source={{
                  ...runProvenance,
                  label: 'Matched records',
                  definition: 'Number of source records this run successfully matched against their target row(s). High match rate is the "no surprises" signal.',
                  query: 'matched FROM sub_catalyst_runs WHERE id = ?',
                  sample: run.matched ?? 0,
                  drillTo: `/catalysts/runs/${runId}?status=matched`,
                }} />
                <CheckCircle2 size={16} style={{ color: 'var(--positive)' }} />
              </div>
            </div>
            <Numeric value={run.matched ?? 0} size="lg" />
          </div>

          <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-[var(--border-card)] hover:-translate-y-px transition-[border-color,transform] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.14em] t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Discrepancies</span>
              <div className="flex items-center gap-1">
                <MetricSource source={{
                  ...runProvenance,
                  label: 'Discrepancies',
                  definition: 'Source/target pairs whose values disagree by more than the configured tolerance. Each is a candidate for a write-back action.',
                  query: 'discrepancies FROM sub_catalyst_runs WHERE id = ?',
                  sample: run.discrepancies ?? 0,
                  drillTo: `/catalysts/runs/${runId}?status=discrepancy`,
                }} />
                <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
              </div>
            </div>
            <Numeric value={run.discrepancies ?? 0} size="lg" />
          </div>

          <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-[var(--border-card)] hover:-translate-y-px transition-[border-color,transform] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.14em] t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Exceptions</span>
              <div className="flex items-center gap-1">
                <MetricSource source={{
                  ...runProvenance,
                  label: 'Exceptions',
                  definition: 'Items the catalyst could not auto-classify — they need an operator decision before a write-back can be proposed.',
                  query: 'exceptions FROM sub_catalyst_runs WHERE id = ?',
                  sample: run.exceptions ?? 0,
                  drillTo: `/catalysts/runs/${runId}?status=exception`,
                }} />
                <XCircle size={16} style={{ color: 'var(--neg)' }} />
              </div>
            </div>
            <Numeric value={run.exceptions ?? 0} size="lg" />
          </div>

          <div className="p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-[var(--border-card)] hover:-translate-y-px transition-[border-color,transform] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.14em] t-muted" style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}>Total Value</span>
              <div className="flex items-center gap-1">
                <MetricSource source={{
                  ...runProvenance,
                  label: 'Total value at stake',
                  definition: 'Sum of value_zar across every record this run touched — the financial scope this catalyst is moving across in one execution.',
                  query: 'total_value FROM sub_catalyst_runs WHERE id = ?',
                  notes: [{ label: 'Currency', value: 'ZAR' }],
                }} />
                <Database size={16} className="t-muted" />
              </div>
            </div>
            <Numeric value={run.totalValue ?? null} unit="currency" compact size="lg" />
          </div>
        </div>
          );
        })()}

        {/* Run Items — filtering + approval workflow */}
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">
                Run Items {items && <span className="t-muted text-sm font-normal">({items.total})</span>}
              </h3>
            </div>
            {items?.review_progress && (
              <div className="flex gap-3 text-xs t-muted font-mono tnum">
                <span style={{ color: 'var(--positive)' }}>{items.review_progress.approved} approved</span>
                <span style={{ color: 'var(--neg)' }}>{items.review_progress.rejected} rejected</span>
                <span style={{ color: 'var(--warning)' }}>{items.review_progress.deferred} deferred</span>
                <span>{items.review_progress.pending} pending</span>
              </div>
            )}
          </div>

          {/* Rand breakdown of the value this run touched — straight from
              items.totals; missing fields render as em-dash, never 0. */}
          {items?.totals && (
            <div
              className="flex gap-4 flex-wrap text-xs font-mono tnum mb-3"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
            >
              <span style={{ color: 'var(--positive)' }}>Matched value {zar(items.totals.total_matched_value)}</span>
              <span style={{ color: 'var(--warning)' }}>Discrepancy value {zar(items.totals.total_discrepancy_value)}</span>
              <span style={{ color: 'var(--neg)' }}>Exception value {zar(items.totals.total_exception_value)}</span>
            </div>
          )}

          <RunItemsFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            reviewFilter={reviewFilter}
            onReviewFilterChange={setReviewFilter}
            severityFilter={severityFilter}
            onSeverityFilterChange={setSeverityFilter}
            resultCount={filteredItems.length}
            totalCount={items?.items.length ?? 0}
          />

          {/* Bulk actions bar */}
          {selectedItemIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-accent/5 border border-accent/20">
              <span className="text-xs t-primary">{selectedItemIds.size} selected</span>
              {pendingSelectedCount < selectedItemIds.size && (
                <span className="text-caption t-muted">
                  ({pendingSelectedCount} pending, {selectedItemIds.size - pendingSelectedCount} already reviewed)
                </span>
              )}
              <div className="flex gap-1 ml-auto">
                <Button
                  size="sm" variant="ghost"
                  className="text-xs"
                  style={{ color: 'var(--positive)' }}
                  onClick={() => askReview('approved')}
                  disabled={bulkReviewing || selectedItemIds.size === 0}
                >
                  <ThumbsUp size={12} className="mr-1" /> Approve
                </Button>
                <Button
                  size="sm" variant="ghost"
                  className="text-xs"
                  style={{ color: 'var(--neg)' }}
                  onClick={() => askReview('rejected')}
                  disabled={bulkReviewing || selectedItemIds.size === 0}
                >
                  <ThumbsDown size={12} className="mr-1" /> Reject
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedItemIds(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          {itemsLoading ? (
            <div className="flex items-center gap-2 justify-center p-8 t-muted text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading items...
            </div>
          ) : itemsError ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--neg)' }}>
              {itemsError}
              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={() => loadItems(itemPage)}>Retry</Button>
              </div>
            </div>
          ) : !items || items.items.length === 0 ? (
            <EmptyState title="No items found for this run." />
          ) : filteredItems.length === 0 ? (
            <EmptyState title="No items match the current filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b border-[var(--border-card)] text-[10px] uppercase tracking-[0.12em] t-muted"
                    style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
                  >
                    <th className="py-2.5 px-2 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all filtered items"
                        checked={allFilteredSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedItemIds(new Set([...selectedItemIds, ...filteredItems.map((it) => it.id)]));
                          } else {
                            const next = new Set(selectedItemIds);
                            filteredItems.forEach((it) => next.delete(it.id));
                            setSelectedItemIds(next);
                          }
                        }}
                      />
                    </th>
                    <th className="py-2.5 px-2 font-normal text-left">#</th>
                    <th className="py-2.5 px-2 font-normal text-left">Status</th>
                    <th className="py-2.5 px-2 font-normal text-left">Source</th>
                    <th className="py-2.5 px-2 font-normal text-right">Source Amt</th>
                    <th className="py-2.5 px-2 font-normal text-left">Target</th>
                    <th className="py-2.5 px-2 font-normal text-right">Target Amt</th>
                    <th className="py-2.5 px-2 font-normal text-right" title="Match confidence (0–100%). Per platform spec, claims rely on ≥70% confidence and ≥25 sample matches.">Conf.</th>
                    <th className="py-2.5 px-2 font-normal text-left">Discrepancy</th>
                    <th className="py-2.5 px-2 font-normal text-left">Review</th>
                    <th className="py-2.5 px-2 font-normal text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const selected = selectedItemIds.has(item.id);
                    const isReviewing = reviewingId === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)] ${selected ? 'bg-accent/5' : ''}`}
                      >
                        <td className="py-2 px-2">
                          <input
                            type="checkbox"
                            aria-label={`Select item ${item.item_number}`}
                            checked={selected}
                            onChange={(e) => {
                              const next = new Set(selectedItemIds);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              setSelectedItemIds(next);
                            }}
                          />
                        </td>
                        <td className="py-2 px-2 t-muted font-mono text-xs">{item.item_number}</td>
                        <td className="py-2 px-2">
                          <Badge
                            variant={item.item_status === 'matched' ? 'success' : item.item_status === 'discrepancy' ? 'warning' : item.item_status === 'exception' ? 'danger' : 'info'}
                            className="text-xs"
                          >
                            {item.item_status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          <div className="t-primary truncate max-w-[160px]" title={item.source_ref}>{item.source_ref || '-'}</div>
                          {item.source_entity && <div className="t-muted text-xs truncate max-w-[160px]" title={item.source_entity}>{item.source_entity}</div>}
                        </td>
                        <td className="py-2 px-2 text-right t-primary font-mono">
                          {typeof item.source_amount === 'number' ? item.source_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </td>
                        <td className="py-2 px-2">
                          <div className="t-primary truncate max-w-[160px]" title={item.target_ref}>{item.target_ref || '-'}</div>
                          {item.target_entity && <div className="t-muted text-xs truncate max-w-[160px]" title={item.target_entity}>{item.target_entity}</div>}
                        </td>
                        <td className="py-2 px-2 text-right t-primary font-mono">
                          {typeof item.target_amount === 'number' ? item.target_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tnum">
                          {typeof item.match_confidence === 'number' ? (
                            <span
                              style={{
                                color: item.match_confidence >= 0.7
                                  ? 'var(--positive)'
                                  : item.match_confidence >= 0.5
                                  ? 'var(--warning)'
                                  : 'var(--neg)',
                              }}
                              title={`Match method: ${item.match_method ?? 'unknown'}`}
                            >
                              {Math.round(item.match_confidence * 100)}%
                            </span>
                          ) : (
                            <span className="t-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {typeof item.discrepancy_amount === 'number' && item.discrepancy_amount !== 0 ? (
                            <span className="font-mono tnum" style={{ color: 'var(--warning)' }}>
                              {item.discrepancy_amount.toFixed(2)}
                              {typeof item.discrepancy_pct === 'number' ? ` (${item.discrepancy_pct.toFixed(1)}%)` : ''}
                            </span>
                          ) : item.exception_type ? (
                            <span style={{ color: 'var(--neg)' }}>{item.exception_type}{item.exception_severity ? ` • ${item.exception_severity}` : ''}</span>
                          ) : (
                            <span className="t-muted">-</span>
                          )}
                          {item.discrepancy_reason && (
                            <div className="text-xs t-muted truncate max-w-[200px]" title={item.discrepancy_reason}>{item.discrepancy_reason}</div>
                          )}
                          {/* Before/after on the disputed ERP field, straight from the run item row. */}
                          {item.discrepancy_field && (item.discrepancy_source_value != null || item.discrepancy_target_value != null) && (
                            <div
                              className="text-xs t-muted font-mono truncate max-w-[220px]"
                              title={`${item.discrepancy_field} — source: ${item.discrepancy_source_value ?? '—'}, target: ${item.discrepancy_target_value ?? '—'}`}
                            >
                              {item.discrepancy_field}: {item.discrepancy_source_value ?? '—'} → {item.discrepancy_target_value ?? '—'}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Badge
                            variant={item.review_status === 'approved' ? 'success' : item.review_status === 'rejected' ? 'danger' : item.review_status === 'deferred' ? 'warning' : 'info'}
                            className="text-xs"
                          >
                            {item.review_status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          {item.review_status === 'pending' ? (
                            <div className="flex gap-1">
                              <button
                                className="p-1 rounded-sm disabled:opacity-50"
                                style={{ color: 'var(--positive)' }}
                                onClick={() => askReview('approved', item.id)}
                                disabled={isReviewing}
                                title="Approve"
                                aria-label="Approve item"
                              >
                                {isReviewing ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                              </button>
                              <button
                                className="p-1 rounded-sm disabled:opacity-50"
                                style={{ color: 'var(--neg)' }}
                                onClick={() => askReview('rejected', item.id)}
                                disabled={isReviewing}
                                title="Reject"
                                aria-label="Reject item"
                              >
                                <ThumbsDown size={12} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-caption t-muted">{item.reviewed_by ? `by ${item.reviewed_by}` : '-'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {items.total > 50 && (
                <div className="flex justify-center items-center gap-2 mt-3 pt-3 border-t border-[var(--border-card)]">
                  <Button size="sm" variant="ghost" disabled={itemPage === 0 || itemsLoading} onClick={() => loadItems(itemPage - 1)}>
                    Prev
                  </Button>
                  <span className="text-xs t-muted">
                    Page {itemPage + 1} of {Math.ceil(items.total / 50)}
                  </span>
                  <Button size="sm" variant="ghost" disabled={(itemPage + 1) * 50 >= items.total || itemsLoading} onClick={() => loadItems(itemPage + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Comments thread */}
        <Card className="p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <MessageCircle className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold t-primary">Comments ({comments.length})</h3>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto mb-4">
            {commentsLoading ? (
              <div className="flex items-center gap-2 justify-center p-4 t-muted text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading comments...
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm t-muted text-center py-4">No comments yet. Be the first to add one.</p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium t-primary">{c.user_name || c.user_id}</span>
                    <span className="text-xs t-muted">{new Date(c.created_at).toLocaleString()}</span>
                    {c.item_id && (
                      <Badge variant="info" className="text-caption">on item</Badge>
                    )}
                    {canDeleteComment(c) && (
                      <button
                        type="button"
                        aria-label="Delete comment"
                        title="Delete comment"
                        className="ml-auto inline-flex items-center justify-center rounded-sm p-1 t-muted disabled:opacity-50 hover:opacity-70"
                        disabled={deletingCommentId === c.id}
                        onClick={() => handleDeleteComment(c.id)}
                        data-testid={`delete-comment-${c.id}`}
                      >
                        {deletingCommentId === c.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    )}
                  </div>
                  <p className="text-sm t-primary whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary focus:outline-none focus:border-accent/40"
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) { e.preventDefault(); handleAddComment(); } }}
              disabled={addingComment}
            />
            <Button variant="primary" onClick={handleAddComment} disabled={addingComment || !newComment.trim()}>
              {addingComment ? <Loader2 size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}
              Post
            </Button>
          </div>
        </Card>

        {/* Catalyst simulator — predicts the next run's recovery against
            this customer's data and tightens the per-tenant calibration
            with each completed run's residual. World-first capability. */}
        {run.clusterId && (
          <CatalystSimulatorCard
            clusterId={run.clusterId}
            subCatalystName={run.subCatalystName}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* KPIs Generated */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">KPIs Generated ({run.kpis?.length || 0})</h3>
            </div>
            {run.kpis && run.kpis.length > 0 ? (
              <div className="space-y-3">
                {run.kpis.map((kpi, i) => (
                  <div key={i} className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium t-primary">{String(kpi.name)}</span>
                      <Badge variant={kpi.status === 'green' ? 'success' : kpi.status === 'amber' ? 'warning' : 'danger'} className="text-xs">
                        {String(kpi.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="t-muted">Value: <span className="t-primary font-medium">{String(kpi.value)} {String(kpi.unit)}</span></span>
                      <span className="t-muted">Target: <span className="t-primary">{String(kpi.target)} {String(kpi.unit)}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No KPIs generated in this run
              </div>
            )}
          </Card>

          {/* Insights — surfaced from runAnalyticsDetail(runId).insights */}
          <Card className="p-6" style={{ borderRadius: '2px' }}>
            <div className="flex items-center gap-3 mb-4">
              <Lightbulb className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <h3 className="text-lg font-semibold t-primary">Insights ({insights.length})</h3>
            </div>
            {insightsLoading ? (
              <div className="flex items-center gap-2 justify-center p-4 t-muted text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading insights...
              </div>
            ) : insights.length === 0 ? (
              <div className="text-center py-8 text-sm t-muted">
                No insights generated for this run yet
              </div>
            ) : (
              <ul className="space-y-2">
                {insights.map((insight, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm t-primary leading-relaxed"
                  >
                    <span
                      className="mt-1.5 inline-block w-1.5 h-1.5 flex-shrink-0"
                      style={{ background: 'var(--accent)', borderRadius: '2px' }}
                      aria-hidden
                    />
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Metrics Created in Pulse */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Activity className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Metrics Created in Pulse ({run.metrics?.length || 0})</h3>
            </div>
            {run.metrics && run.metrics.length > 0 ? (
              <div className="space-y-3">
                {run.metrics.map((metric, i) => (
                  <div key={i} className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium t-primary">{String(metric.name)}</span>
                      <Badge variant={metric.status === 'green' ? 'success' : metric.status === 'amber' ? 'warning' : 'danger'} className="text-xs">
                        {String(metric.status)}
                      </Badge>
                    </div>
                    <div className="text-sm t-muted">
                      Value: <span className="t-primary font-medium">{String(metric.value)} {String(metric.unit)}</span>
                    </div>
                    {metric.id ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/pulse?metric=${encodeURIComponent(String(metric.id))}`)}
                        className="text-xs text-accent hover:underline mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
                        aria-label={`View ${String(metric.name)} in Pulse`}
                      >
                        View in Pulse →
                      </button>
                    ) : (
                      <span className="text-xs t-muted mt-1 inline-block" title="Metric not yet registered in Pulse">
                        Pulse link unavailable
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No metrics created in this run
              </div>
            )}
          </Card>

          {/* Source Data Attribution */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Source Data Processed</h3>
            </div>
            {run.sourceData && run.sourceData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="border-b border-[var(--border-card)] text-[10px] uppercase tracking-[0.12em] t-muted"
                      style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
                    >
                      <th className="text-left py-2.5 px-3 font-normal">Record ID</th>
                      <th className="text-left py-2.5 px-3 font-normal">Source System</th>
                      <th className="text-left py-2.5 px-3 font-normal">Record Type</th>
                      <th className="text-right py-2.5 px-3 font-normal">Value</th>
                      <th className="text-center py-2.5 px-3 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.sourceData.slice(0, 50).map((record, i) => (
                      <tr key={i} className="border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)]">
                        <td className="py-2 px-3 t-primary font-mono text-xs">{String(record.id)}</td>
                        <td className="py-2 px-3 t-muted">{String(record.sourceSystem)}</td>
                        <td className="py-2 px-3 t-muted">{String(record.recordType)}</td>
                        <td className="py-2 px-3 text-right t-primary">{typeof record.value === 'number' ? record.value.toLocaleString() : String(record.value)}</td>
                        <td className="py-2 px-3 text-center">
                          <Badge variant={record.status === 'matched' ? 'success' : record.status === 'discrepancy' ? 'warning' : 'danger'} className="text-xs">
                            {String(record.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {run.sourceData.length > 50 && (
                  <p className="text-xs t-muted text-center py-4">
                    Showing 50 of {run.sourceData.length} records
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No source data attribution available
              </div>
            )}
          </Card>

          {/* Execution Timeline */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Clock className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Execution Timeline</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-sm mt-1.5" style={{ background: 'var(--info)' }} />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Run Started</p>
                  <p className="text-xs t-muted">{new Date(run.startedAt).toLocaleString()}</p>
                </div>
              </div>
              {run.completedAt && (
                <div className="flex items-start gap-3">
                  <div
                    className="w-3 h-3 rounded-sm mt-1.5"
                    style={{
                      background: run.status === 'success'
                        ? 'var(--positive)'
                        : run.status === 'failed'
                        ? 'var(--neg)'
                        : 'var(--warning)',
                    }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium t-primary">{isFailed ? 'Run Failed' : 'Run Completed'}</p>
                    <p className="text-xs t-muted">{new Date(run.completedAt).toLocaleString()}</p>
                    <p className="text-xs t-muted mt-1">
                      Duration: {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000 / 60)} minutes
                    </p>
                  </div>
                </div>
              )}
              {/* Downstream events (health recalcs, Pulse refreshes) are not
                  reported by this API — only API-backed events are listed. */}
            </div>
          </Card>
        </div>
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === 'bulk'
            ? `${confirm.action === 'approved' ? 'Approve' : confirm.action === 'rejected' ? 'Reject' : confirm.action === 'deferred' ? 'Defer' : 'Update'} ${confirm.count} items?`
            : confirm
              ? `${confirm.action === 'approved' ? 'Approve' : confirm.action === 'rejected' ? 'Reject' : 'Update'} this item?`
              : ''
        }
        message={
          confirm?.kind === 'bulk'
            ? `This will mark ${confirm.count} selected item${confirm.count === 1 ? '' : 's'} as "${confirm.action}". Only pending items will be updated.`
            : 'This action will update the review status for this item. Any downstream KPIs or metrics tied to this run will reflect the change on next refresh.'
        }
        confirmLabel={confirm?.action === 'approved' ? 'Approve' : confirm?.action === 'rejected' ? 'Reject' : 'Confirm'}
        confirmVariant={confirm?.action === 'rejected' ? 'danger' : 'primary'}
        onConfirm={doReview}
        onCancel={() => setConfirm(null)}
        busy={reviewingId !== null || bulkReviewing}
      />
    </div>
  );
}
