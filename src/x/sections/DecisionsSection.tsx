// Decisions: the gate. The strip shows the river truth — confirmed value
// pooling at your signature, signed value collecting — and each pending action
// opens the review drawer with its full evidence chain. Approval rights come
// from the API (step-up MFA); the persona lens only greys the buttons, it
// never grants rights.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, isStepUpRequired } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import type { Persona } from '../persona';
import { decisionsRiver } from '../flows';
import { MiniRiver } from '../MiniRiver';
import { SideDrawer } from '../SideDrawer';

type PendingAction = Awaited<ReturnType<typeof api.erp.listAllActions>>['actions'][number];
type Evidence = Awaited<ReturnType<typeof api.erp.actionEvidence>>;

// LLM reasoning arrives as multi-paragraph markdown; cards get one plain
// sentence, the review drawer keeps the full (de-markdowned) text.
function plainReasoning(text: string): string {
  // ponytail: underscores stay — they appear in identifiers like bank_fee_unallocated
  return text.replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim();
}
function briefReasoning(text: string): string {
  const plain = plainReasoning(text);
  const sentence = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
  return sentence.length > 140 ? `${sentence.slice(0, 139).trimEnd()}…` : sentence;
}

// Monday 00:00 local — the "this week" boundary for collected value.
function weekStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function DecisionsSection({ persona, canApprove, onAskJeff }: {
  persona: Persona | null;
  canApprove: boolean; // role ∧ persona, computed upstream — API stays the enforcement point
  onAskJeff: (ctx: string) => void;
}) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [actions, setActions] = useState<PendingAction[] | null>(null);
  const [pendingSum, setPendingSum] = useState<{ count: number; zar: number } | null>(null);
  const [collected, setCollected] = useState<{ count: number; zar: number; partial: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<PendingAction | null>(null);
  const [evidence, setEvidence] = useState<Record<string, Evidence | 'loading' | 'failed'>>({});
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState<'approve' | 'reject' | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      // ponytail: limit 200 covers current tenants; page when a tenant exceeds it
      const [pend, done, sum] = await Promise.allSettled([
        api.erp.listAllActions({ status: 'pending_approval', limit: 200 }),
        api.erp.listAllActions({ status: 'completed', limit: 200 }),
        api.erp.actionsSummary(),
      ]);
      if (pend.status === 'fulfilled') {
        // biggest decision first — the queue is triage, not chronology
        setActions([...pend.value.actions].sort((a, b) => (b.value_zar || 0) - (a.value_zar || 0)));
        setError(null);
      } else {
        setActions(null);
        setError("couldn't load the decision queue");
      }
      // header + strip figures come from the tenant-wide summary, never a
      // truncated page sum
      if (sum.status === 'fulfilled') {
        setPendingSum({ count: sum.value.summary.pending_approval_count, zar: sum.value.summary.pending_approval_value_zar });
      } else if (pend.status === 'fulfilled') {
        setPendingSum({ count: pend.value.total ?? pend.value.actions.length, zar: pend.value.actions.reduce((s, a) => s + (a.value_zar || 0), 0) });
      } else {
        setPendingSum(null);
      }
      if (done.status === 'fulfilled') {
        const ws = weekStart();
        const week = done.value.actions.filter((a) => a.completed_at && new Date(a.completed_at).getTime() >= ws);
        const partial = (done.value.total ?? done.value.actions.length) > done.value.actions.length;
        setCollected({ count: week.length, zar: week.reduce((s, a) => s + (a.value_zar || 0), 0), partial });
      } else {
        setCollected(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load, companyId]);

  const openReview = (a: PendingAction) => {
    setReview(a);
    setStepUp(null);
    setMfaCode('');
    setMfaError(null);
    setRejecting(false);
    setReason('');
    if (!evidence[a.id]) {
      setEvidence((e) => ({ ...e, [a.id]: 'loading' }));
      api.erp.actionEvidence(a.id)
        .then((ev) => setEvidence((e) => ({ ...e, [a.id]: ev })))
        .catch(() => setEvidence((e) => ({ ...e, [a.id]: 'failed' })));
    }
  };
  const closeReview = useCallback(() => { setReview(null); setStepUp(null); setMfaCode(''); setMfaError(null); setRejecting(false); setReason(''); }, []);

  const act = async (id: string, kind: 'approve' | 'reject', code?: string) => {
    setBusy(true);
    setMfaError(null);
    try {
      if (kind === 'approve') await api.catalysts.approveAction(id, 'ui', code);
      // reason state survives the step-up round-trip — the reviewer types it once
      else await api.catalysts.rejectAction(id, 'ui', reason.trim(), code);
      closeReview();
      await load();
    } catch (e) {
      if (isStepUpRequired(e)) setStepUp(kind);
      else if (e instanceof ApiError && e.status === 401 && code) setMfaError('Invalid code. Try again.');
      else setMfaError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const money = useCallback((v: number | null | undefined) => formatCompactCurrency(v ?? null, currency), [currency]);

  const strip = useMemo(
    () => decisionsRiver(pendingSum, collected, canApprove, (v) => money(v)),
    [pendingSum, collected, canApprove, money],
  );

  const ev = review ? evidence[review.id] : undefined;

  return (
    <section id="decisions">
      <div className="head">
        <span className="kicker">Decisions</span>
        <h2>Waiting on you {pendingSum && pendingSum.count > 0 && <span className="meta">{pendingSum.count} pending · {money(pendingSum.zar)}</span>}</h2>
      </div>

      {!loading && <MiniRiver graph={strip} label="Decision flow: confirmed value pooling at your signature, signed value collected this week" />}
      {!loading && collected?.partial && (
        <p className="flow-note">This week's collected figure counts the latest 200 completions only.</p>
      )}

      {loading && <p className="flow-note">Loading…</p>}
      {!loading && error && <p className="flow-note">— {error}</p>}
      {!loading && actions && actions.length === 0 && (
        <p className="flow-note">Nothing at the gate. New catalyst findings that need sign-off will pool here.</p>
      )}
      {!loading && actions && pendingSum && pendingSum.count > actions.length && (
        <p className="flow-note">Showing the top {actions.length} of {pendingSum.count} by value.</p>
      )}

      {actions?.map((a) => {
        const days = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86_400_000);
        return (
          <div key={a.id} className="decision">
            <button className="amt num" onClick={() => onAskJeff(`Pending action "${a.catalyst_name}" (${a.action_type}) worth ${money(a.value_zar)}`)}>
              {money(a.value_zar)}
            </button>
            <div className="what">
              <p><b>{a.catalyst_name}</b> — {a.action_type.replace(/_/g, ' ')}</p>
              <p className="sub">
                <b style={days >= 14 ? { color: 'var(--warn)' } : undefined}>
                  {days <= 0 ? 'raised today' : `waiting ${days} day${days === 1 ? '' : 's'}`}
                </b>
                {' · '}raised {new Date(a.created_at).toLocaleDateString()}{a.reasoning ? ` · ${briefReasoning(a.reasoning)}` : ''}
              </p>
            </div>
            <div className="acts">
              <button className="go" onClick={() => openReview(a)}>Review &amp; sign</button>
            </div>
          </div>
        );
      })}

      {review && (
        <SideDrawer label={`Review ${review.catalyst_name}`} head={<span className="kicker">Review &amp; sign</span>} onClose={closeReview}>
          <div className="rc-amt num">{money(review.value_zar)}</div>
          <p className="rc-meta">
            <b>{review.catalyst_name}</b> — {review.action_type.replace(/_/g, ' ')}
            <br />Raised {new Date(review.created_at).toLocaleDateString()}
            {review.reasoning ? <><br />{plainReasoning(review.reasoning)}</> : null}
          </p>

          <div className="rc-sec">
            <div className="rc-id">Evidence chain</div>
            {ev === 'loading' && <p className="rc-meta">Loading evidence…</p>}
            {ev === 'failed' && <p className="rc-meta">— couldn't load the evidence chain</p>}
            {ev && ev !== 'loading' && ev !== 'failed' && (
              <>
                {ev.finding ? (
                  <p className="rc-meta">
                    <b>{ev.finding.title}</b> — {ev.finding.description}
                    {ev.finding.root_cause && <><br /><b>Root cause:</b> {ev.finding.root_cause}</>}
                    {ev.finding.prescription && <><br /><b>Prescription:</b> {ev.finding.prescription}</>}
                  </p>
                ) : (
                  <p className="rc-meta">No linked finding on record for this action.</p>
                )}
                {ev.finding?.evidence?.sample_records && ev.finding.evidence.sample_records.length > 0 && (
                  <table className="rc-table">
                    <thead><tr><th>Ref</th><th>Source</th><th>Target</th><th>Difference</th></tr></thead>
                    <tbody>
                      {ev.finding.evidence.sample_records.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td>{r.ref ?? '—'}</td><td>{r.source_value ?? '—'}</td><td>{r.target_value ?? '—'}</td>
                          <td className="num">{r.difference != null ? money(r.difference) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ev.action.confidence != null && (
                  <p className="rc-meta">Confidence {Math.round(ev.action.confidence * 100)}%{ev.action.sample_size != null ? ` on a sample of ${ev.action.sample_size}` : ''}</p>
                )}
                {(ev.execution_logs ?? []).length > 0 && (
                  <p className="rc-meta">{ev.execution_logs.length} execution steps logged.</p>
                )}
              </>
            )}
          </div>

          {stepUp ? (
            <div className="rc-sec">
              <span className="kicker">Step-up verification</span>
              <div className="acts">
                <input
                  className="ai-in" style={{ maxWidth: '10rem' }}
                  value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && mfaCode.length === 6) act(review.id, stepUp, mfaCode); }}
                  placeholder="6-digit code" inputMode="numeric" autoFocus
                />
                <button className="go" disabled={mfaCode.length !== 6 || busy} onClick={() => act(review.id, stepUp, mfaCode)}>
                  Confirm {stepUp}
                </button>
                <button className="ghost" onClick={() => { setStepUp(null); setMfaCode(''); setMfaError(null); }}>Cancel</button>
              </div>
            </div>
          ) : rejecting ? (
            <div className="rc-sec">
              <span className="kicker">Reason for rejection</span>
              <div className="acts">
                <input
                  className="ai-in"
                  value={reason} onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && reason.trim()) act(review.id, 'reject'); }}
                  placeholder="Why is this being sent back?" autoFocus
                />
                <button className="go" disabled={!reason.trim() || busy} onClick={() => act(review.id, 'reject')}>
                  {busy ? '…' : 'Confirm reject'}
                </button>
                <button className="ghost" onClick={() => { setRejecting(false); setReason(''); setMfaError(null); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="rc-sec">
              <div className="acts">
                <button
                  className="go"
                  disabled={!canApprove || busy}
                  style={!canApprove ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  title={!canApprove ? `${persona ? persona.label : 'Your role'} cannot approve — viewing only` : undefined}
                  onClick={() => act(review.id, 'approve')}
                >
                  {busy ? '…' : 'Approve & release'}
                </button>
                <button
                  className="ghost"
                  disabled={!canApprove || busy}
                  style={!canApprove ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  title={!canApprove ? `${persona ? persona.label : 'Your role'} cannot reject — viewing only` : undefined}
                  onClick={() => setRejecting(true)}
                >
                  Reject
                </button>
                <button className="ghost" onClick={() => { onAskJeff(`Pending action "${review.catalyst_name}" (${review.action_type}) worth ${money(review.value_zar)}`); }}>
                  ✦ Explain
                </button>
              </div>
            </div>
          )}
          {mfaError && <p className="flow-note" style={{ color: 'var(--bad)' }}>{mfaError}</p>}
        </SideDrawer>
      )}
    </section>
  );
}
