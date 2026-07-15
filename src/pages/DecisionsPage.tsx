/**
 * Decisions — the full DoA queue (frontend-v2 spec §4). Where the Brief shows
 * the top ≤3 decisions and links onward, this is every catalyst action waiting
 * on a human, each acted on INLINE (approve / reject) without leaving the page.
 * It consolidates what used to be a tab buried inside CatalystsPage into one
 * honest editorial column, reusing the Brief's closed primitive set.
 *
 * Honesty: amounts come from the catalyst's own inputData or not at all (no
 * fabricated figure), rendered `unverified` — these are proposed actions, not
 * confirmed recoveries. Reasoning text is the catalyst's, shown verbatim.
 * Reject requires a reason (destructive-ish, and the backend records it).
 * Every mutation reflects the real API result; a failed call surfaces the
 * error and leaves the row in place — nothing is optimistically faked.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { BriefColumn, Dateline, DecisionCard, Sentence, BriefHeading } from '@/components/brief/primitives';
import { amountFrom } from '@/pages/BriefPage';

type Approval = {
  id: string; clusterName: string; domain: string; catalystName: string;
  action: string; confidence: number; reasoning: string;
  inputData: Record<string, unknown>; createdAt: string;
};

export function DecisionsPage() {
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Approval[]>([]);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setFailed(false);
    api.catalysts.pendingApprovals()
      .then((r) => setRows(r.approvals as Approval[]))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const decide = async (id: string, kind: 'approve' | 'reject') => {
    setError(null);
    let reason: string | undefined;
    if (kind === 'reject') {
      reason = window.prompt('Reason for rejecting? (recorded on the action)')?.trim() || undefined;
      if (!reason) return; // reject needs a stated reason — no silent kills
    }
    setBusyId(id);
    try {
      if (kind === 'approve') await api.catalysts.approveAction(id);
      else await api.catalysts.rejectAction(id, undefined, reason);
      setRows((rs) => rs.filter((r) => r.id !== id)); // remove only after the API confirms
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${kind} — try again.`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>;
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <BriefColumn>
      <Dateline
        dateLabel="Decisions"
        company={`${rows.length} waiting on you · ${dateLabel}`}
        freshness={failed ? "Couldn't load the decision queue." : rows.length === 0 ? 'Nothing waiting — the queue is clear.' : 'Each decision is recorded against your name.'}
      />

      {error && (
        <div className="text-sm rounded-lg px-3.5 py-2.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--danger, var(--text-primary))' }}>
          {error}
        </div>
      )}

      {failed && (
        <Sentence>
          The queue couldn't be loaded.{' '}
          <button onClick={load} className="text-accent font-medium hover:underline">Retry</button>
        </Sentence>
      )}

      {!failed && rows.length === 0 && (
        <Sentence>No catalyst actions are waiting on a decision right now.</Sentence>
      )}

      {rows.length > 0 && <BriefHeading>Awaiting your decision</BriefHeading>}
      {rows.map((d) => {
        const amt = amountFrom(d.inputData);
        const busy = busyId === d.id;
        return (
          <DecisionCard
            key={d.id}
            title={d.catalystName || d.action}
            amount={amt}
            amountProvenance={amt != null ? { kind: 'unverified' } : undefined}
            counterparty={[d.clusterName, d.domain].filter(Boolean).join(' · ')}
            whatApproving={d.reasoning || d.action}
            consequence={`Catalyst confidence ${Math.round(d.confidence * 100)}%. No deadline set — it stays queued until you decide.`}
            queuedBy={d.catalystName || 'Atheon catalyst'}
            actions={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => decide(d.id, 'reject')}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-sm font-medium t-muted hover:t-primary disabled:opacity-40"
                >
                  <X size={14} /> Reject
                </button>
                <button
                  onClick={() => decide(d.id, 'approve')}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium bg-accent text-[var(--text-on-accent)] hover:bg-accent/80 disabled:opacity-40"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
                </button>
              </div>
            }
          />
        );
      })}

      {user && (
        <Sentence>
          Looking for the deeper run detail or execution logs?{' '}
          <button onClick={() => navigate('/catalysts')} className="text-accent font-medium hover:underline">Open Catalysts →</button>
        </Sentence>
      )}
    </BriefColumn>
  );
}

export default DecisionsPage;
