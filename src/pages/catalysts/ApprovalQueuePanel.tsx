import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  KeyRound,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  UserPlus,
  Clock,
} from 'lucide-react';
import { api, ApiError, isStepUpRequired } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type ApprovalsResp = Awaited<ReturnType<typeof api.catalysts.pendingApprovals>>;
type Approval = ApprovalsResp['approvals'][number];

/**
 * The worker doesn't currently project `escalation_level` onto the approvals
 * payload, but the underlying `catalyst_actions` row carries it and the
 * `/escalate` endpoint returns `escalationLevel`. We defensively read it from
 * the response if/when it's added — both snake_case + camelCase variants — and
 * normalize "L1"/"1"/"manager"/etc. into a single canonical tier.
 */
type ApprovalWithMeta = Approval & {
  escalation_level?: string | number | null;
  escalationLevel?: string | number | null;
};

type Tier = 'L1' | 'L2' | 'L3' | null;

function normalizeEscalation(raw: unknown): Tier {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === '1' || s === 'l1' || s === 'team_lead' || s === 'warned') return 'L1';
  if (s === '2' || s === 'l2' || s === 'manager' || s === 'escalated') return 'L2';
  if (s === '3' || s === 'l3' || s === 'executive' || s === 'auto_rejected') return 'L3';
  return null;
}

/** Pending duration → human label + StatusPill colour tier. */
function slaTier(createdAt: string): { label: string; tone: 'neutral' | 'amber' | 'red' } {
  const startedMs = new Date(createdAt).getTime();
  const elapsedMs = Math.max(0, Date.now() - startedMs);
  const hours = Math.floor(elapsedMs / 3_600_000);
  const minutes = Math.floor((elapsedMs % 3_600_000) / 60_000);
  const label = hours > 0 ? `pending ${hours}h ${minutes}m` : `pending ${minutes}m`;
  if (elapsedMs >= 6 * 3_600_000) return { label, tone: 'red' };
  if (elapsedMs >= 2 * 3_600_000) return { label, tone: 'amber' };
  return { label, tone: 'neutral' };
}

function confidencePill(confidence: number): React.ReactNode {
  if (confidence >= 0.85) return <StatusPill status="completed" label={`${(confidence * 100).toFixed(0)}% conf.`} />;
  if (confidence >= 0.65) return <StatusPill status="amber" label={`${(confidence * 100).toFixed(0)}% conf.`} />;
  return <StatusPill status="failed" label={`${(confidence * 100).toFixed(0)}% conf.`} />;
}

type SinglePending = {
  kind: 'single';
  approvalId: string;
  action: 'approve' | 'reject';
  reason?: string;
};
type BatchPending = {
  kind: 'batch';
  action: 'approve' | 'reject';
  ids: string[];
  reason?: string;
};
type Pending = SinglePending | BatchPending;

export function ApprovalQueuePanel() {
  const currentUser = useAppStore((s) => s.user);
  const [data, setData] = useState<ApprovalsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stepUp, setStepUp] = useState<Pending | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  // Re-render once a minute so SLA timers tick without socket plumbing.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.catalysts.pendingApprovals();
      // Never trust the shape: a malformed/empty response must not crash the
      // render (this is the default landing tab now). Normalise to a real array.
      const approvals = Array.isArray(resp?.approvals) ? resp.approvals : [];
      setData({ approvals, total: typeof resp?.total === 'number' ? resp.total : approvals.length });
      // Prune selection of IDs that disappeared.
      setSelected((prev) => {
        const ids = new Set(approvals.map((a) => a.id));
        const next = new Set<string>();
        prev.forEach((id) => { if (ids.has(id)) next.add(id); });
        return next;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load approval queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (stepUp && mfaInputRef.current) mfaInputRef.current.focus();
  }, [stepUp]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ── Single-row action — preserves the original step-up MFA pattern. ────
  const handleAction = useCallback(async (approvalId: string, action: 'approve' | 'reject', reason?: string, code?: string) => {
    setBusyId(approvalId);
    setMfaError(null);
    try {
      if (action === 'approve') {
        await api.catalysts.approveAction(approvalId, 'ui', code);
      } else {
        await api.catalysts.rejectAction(approvalId, 'ui', reason || 'Rejected by reviewer', code);
      }
      setStepUp(null);
      setMfaCode('');
      await load();
    } catch (e) {
      if (isStepUpRequired(e)) {
        setStepUp({ kind: 'single', approvalId, action, reason });
        setMfaError(null);
      } else if (e instanceof ApiError && e.status === 401 && code) {
        setMfaError('Invalid TOTP code. Try again.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Action failed');
      }
    } finally {
      setBusyId(null);
    }
  }, [load]);

  // ── Batch action — one MFA prompt up-front, reused for every call. ─────
  const runBatch = useCallback(async (ids: string[], action: 'approve' | 'reject', reason: string | undefined, code: string | undefined) => {
    setBatchBusy(true);
    setMfaError(null);
    let ok = 0;
    let failed = 0;
    let needStepUp = false;
    let authFail = false;
    try {
      for (const id of ids) {
        try {
          if (action === 'approve') {
            await api.catalysts.approveAction(id, 'ui', code);
          } else {
            await api.catalysts.rejectAction(id, 'ui', reason || 'Rejected by reviewer', code);
          }
          ok += 1;
        } catch (e) {
          if (isStepUpRequired(e) && !code) {
            // Stash for re-run after MFA.
            needStepUp = true;
            break;
          }
          if (e instanceof ApiError && e.status === 401 && code) {
            authFail = true;
            break;
          }
          failed += 1;
        }
      }

      if (needStepUp) {
        setStepUp({ kind: 'batch', action, ids, reason });
        return;
      }
      if (authFail) {
        setMfaError('Invalid TOTP code. Try again.');
        return;
      }

      setStepUp(null);
      setMfaCode('');
      setSelected(new Set());
      setToast(
        action === 'approve'
          ? `${ok} approved${failed ? `, ${failed} failed` : ''}`
          : `${ok} rejected${failed ? `, ${failed} failed` : ''}`,
      );
      await load();
    } finally {
      setBatchBusy(false);
    }
  }, [load]);

  const onBatchApprove = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    void runBatch(ids, 'approve', undefined, undefined);
  }, [selected, runBatch]);

  const onBatchReject = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    // One reason for the whole batch — pulled inline to avoid a second modal.
    const reason = window.prompt(`Reject ${ids.length} action${ids.length === 1 ? '' : 's'} — reason:`, '');
    if (reason == null) return;
    const trimmed = reason.trim() || 'Rejected by reviewer';
    void runBatch(ids, 'reject', trimmed, undefined);
  }, [selected, runBatch]);

  // ── Per-row escalate + assign-to-me ────────────────────────────────────
  const handleEscalate = useCallback(async (approvalId: string) => {
    setBusyId(approvalId);
    try {
      await api.catalysts.escalateException(approvalId);
      setToast('Action escalated');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Escalation failed');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleAssignToMe = useCallback(async (approvalId: string) => {
    if (!currentUser?.id) return;
    setBusyId(approvalId);
    try {
      await api.catalysts.assignAction(approvalId, currentUser.id);
      setToast('Assigned to you');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Assignment failed');
    } finally {
      setBusyId(null);
    }
  }, [load, currentUser?.id]);

  const onConfirmStepUp = useCallback(async () => {
    if (!stepUp || mfaCode.length !== 6) return;
    if (stepUp.kind === 'single') {
      await handleAction(stepUp.approvalId, stepUp.action, stepUp.reason, mfaCode);
    } else {
      await runBatch(stepUp.ids, stepUp.action, stepUp.reason, mfaCode);
    }
  }, [stepUp, mfaCode, handleAction, runBatch]);

  const onCancelStepUp = useCallback(() => {
    setStepUp(null);
    setMfaCode('');
    setMfaError(null);
  }, []);

  const grouped = useMemo(() => {
    if (!data) return [] as Approval[];
    return [...data.approvals].sort((a, b) => {
      if (a.confidence === b.confidence) return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return a.confidence - b.confidence;
    });
  }, [data]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === grouped.length) return new Set();
      return new Set(grouped.map((a) => a.id));
    });
  }, [grouped]);

  if (loading) return <LoadingState variant="cards" count={3} />;
  if (error) return <Card><ErrorState error={error} onRetry={load} /></Card>;
  if (!data || data.approvals.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-1.5 mb-3">
          <ShieldCheck size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Approval queue</h3>
        </div>
        <EmptyState
          title="Nothing waiting on you"
          description="Catalyst actions below the confidence threshold or escalated by HITL rules will appear here for sign-off."
        />
      </Card>
    );
  }

  const selectedCount = selected.size;
  const allSelected = selectedCount > 0 && selectedCount === grouped.length;

  return (
    <div className="space-y-4 animate-fadeIn pb-20">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Approval queue · {data.total}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleSelectAll}
            className="px-2.5 py-1.5 rounded-md text-caption font-medium border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color] duration-[var(--dur-press,160ms)]"
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {grouped.map((ap) => {
          const isOpen = expanded === ap.id;
          const isBusy = busyId === ap.id || batchBusy;
          const isChecked = selected.has(ap.id);
          const meta = ap as ApprovalWithMeta;
          const tier = normalizeEscalation(meta.escalation_level ?? meta.escalationLevel ?? null)
            // Fall back to status when API hasn't surfaced the field — escalated rows always merit L2.
            ?? (ap.status === 'escalated' ? 'L2' : null);
          const sla = slaTier(ap.createdAt);
          return (
            <Card key={ap.id}>
              <div className="flex items-start gap-3 mb-2">
                <label className="flex items-center pt-0.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(ap.id)}
                    disabled={batchBusy}
                    className="h-3.5 w-3.5 rounded-sm border-[var(--border-card)] text-accent accent-[var(--accent)] focus:ring-2 focus:ring-accent/40"
                    aria-label={`Select ${ap.catalystName}`}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold t-primary truncate">{ap.catalystName}</h4>
                    <span className="text-caption t-muted">·</span>
                    <span className="text-caption t-secondary capitalize">{ap.domain || ap.clusterName}</span>
                  </div>
                  <p className="text-caption t-muted mt-0.5">
                    Action: <span className="t-secondary font-mono">{ap.action}</span> · {new Date(ap.createdAt).toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    <StatusPill status={ap.status === 'escalated' ? 'high' : 'pending'} label={ap.status === 'escalated' ? 'Escalated' : 'Pending'} />
                    {tier && <SlaBadge tone="escalation" label={tier} />}
                  </div>
                  <div className="flex items-center gap-1">
                    {confidencePill(ap.confidence)}
                    <SlaBadge tone={sla.tone} label={sla.label} />
                  </div>
                </div>
              </div>

              {ap.reasoning && (
                <p className="text-caption t-secondary mb-2 italic border-l-2 border-accent/30 pl-2">{ap.reasoning}</p>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={() => setExpanded(isOpen ? null : ap.id)}
                  className="flex items-center gap-1 text-caption t-muted hover:t-primary transition-[color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                  {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  Evidence
                </button>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {currentUser?.id && (
                    <button
                      disabled={isBusy}
                      onClick={() => handleAssignToMe(ap.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
                      title="Assign to me"
                    >
                      <UserPlus size={12} /> Assign
                    </button>
                  )}
                  <button
                    disabled={isBusy}
                    onClick={() => handleEscalate(ap.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-[var(--warning)]/30 text-[var(--warning)] hover:bg-[var(--warning)]/10 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
                  >
                    <AlertTriangle size={12} /> Escalate
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => handleAction(ap.id, 'reject')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--neg)]/30 text-neg hover:bg-neg/10 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
                  >
                    <XCircle size={12} /> Reject
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => handleAction(ap.id, 'approve')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-[var(--text-on-accent)] hover:bg-accent/90 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
                  >
                    <CheckCircle2 size={12} /> Approve
                  </button>
                </div>
              </div>

              {isOpen && (
                <pre className="mt-3 p-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)] text-caption t-secondary overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(ap.inputData, null, 2)}
                </pre>
              )}
            </Card>
          );
        })}
      </div>

      {/* Sticky batch footer */}
      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border-card)] bg-[var(--bg-card-solid)]/95 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-caption t-primary font-medium">
              Selected: <span className="font-mono">{selectedCount}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSelected(new Set())}
                disabled={batchBusy}
                className="px-3 py-1.5 rounded-md text-xs font-medium t-secondary hover:t-primary transition-[color] duration-[var(--dur-press,160ms)] disabled:opacity-50"
              >
                Clear
              </button>
              <button
                onClick={onBatchReject}
                disabled={batchBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--neg)]/30 text-neg hover:bg-neg/10 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] active:scale-[0.97] disabled:opacity-50"
              >
                <XCircle size={12} /> Reject selected
              </button>
              <button
                onClick={onBatchApprove}
                disabled={batchBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-[var(--text-on-accent)] hover:bg-accent/90 transition-[background-color,transform] duration-[var(--dur-press,160ms)] active:scale-[0.97] disabled:opacity-50"
              >
                <CheckCircle2 size={12} /> Approve selected
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-sm bg-[var(--bg-card-solid)] border border-[var(--border-card)] text-caption t-primary shadow-md animate-fadeIn">
          {toast}
        </div>
      )}

      {stepUp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stepup-title"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm animate-fadeIn"
          onClick={onCancelStepUp}
        >
          <div
            className="w-[min(92vw,420px)] rounded-md border border-[var(--border-card)] bg-[var(--bg-card-solid)] p-5"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'pop 200ms cubic-bezier(0.23,1,0.32,1)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={16} className="text-accent" />
              <h3 id="stepup-title" className="text-base font-semibold t-primary">Re-confirm with TOTP</h3>
            </div>
            <p className="text-caption t-muted mb-3">
              {stepUp.kind === 'batch'
                ? `${stepUp.action === 'approve' ? 'Approving' : 'Rejecting'} ${stepUp.ids.length} catalyst action${stepUp.ids.length === 1 ? '' : 's'} releases write-backs. One code covers the whole batch.`
                : `${stepUp.action === 'approve' ? 'Approving' : 'Rejecting'} this catalyst action releases a write-back. Enter the current 6-digit code from your authenticator.`}
            </p>
            <input
              ref={mfaInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter' && mfaCode.length === 6) onConfirmStepUp(); }}
              className="w-full h-11 px-3 rounded-md border border-[var(--border-card)] bg-[var(--bg-card-solid)] t-primary font-mono text-lg tabular-nums tracking-[0.4em] text-center focus:outline-none focus:ring-2 focus:ring-accent/50"
              placeholder="000000"
              aria-label="One-time code"
            />
            {mfaError && <p className="text-caption text-neg mt-2">{mfaError}</p>}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={onCancelStepUp}
                className="px-3 py-1.5 rounded-md text-xs font-medium t-secondary hover:t-primary transition-[color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
              >Cancel</button>
              <button
                disabled={mfaCode.length !== 6 || busyId !== null || batchBusy}
                onClick={onConfirmStepUp}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent text-[var(--text-on-accent)] hover:bg-accent/90 transition-[background-color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
              >Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small inline badge — kept co-located so we don't sprinkle one-off pills. ──
type BadgeTone = 'neutral' | 'amber' | 'red' | 'escalation';
function SlaBadge({ tone, label }: { tone: BadgeTone; label: string }): JSX.Element {
  const palette: Record<BadgeTone, string> = {
    neutral:    'border-[var(--border-card)] t-muted bg-[var(--bg-secondary)]',
    amber:      'border-[rgba(154,107,31,.4)] text-[var(--warning)] bg-[rgba(154,107,31,.08)]',
    red:        'border-[rgb(var(--neg-rgb)/0.4)] text-neg bg-[rgb(var(--neg-rgb)/0.08)]',
    escalation: 'border-[rgb(var(--neg-rgb)/0.5)] text-neg bg-[rgb(var(--neg-rgb)/0.12)] font-semibold',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border font-mono text-caption px-1.5 py-0 leading-5 ${palette[tone]}`}
      aria-label={tone === 'escalation' ? `Escalation tier ${label}` : `SLA ${label}`}
    >
      {tone === 'escalation' ? <AlertTriangle size={10} aria-hidden /> : <Clock size={10} aria-hidden />}
      {label}
    </span>
  );
}
