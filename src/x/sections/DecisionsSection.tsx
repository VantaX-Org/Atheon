// Decisions: the gate. Every pending action with its evidence chain —
// approve or send back. Approval rights come from the API (step-up MFA);
// the persona lens only greys the buttons, it never grants rights.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, isStepUpRequired } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import type { Persona } from '../persona';

type PendingAction = Awaited<ReturnType<typeof api.erp.listAllActions>>['actions'][number];
type Evidence = Awaited<ReturnType<typeof api.erp.actionEvidence>>;

export function DecisionsSection({ persona, onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void }) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [actions, setActions] = useState<PendingAction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, Evidence | 'loading' | 'failed'>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<{ id: string; kind: 'approve' | 'reject' } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.erp.listAllActions({ status: 'pending_approval', limit: 50 });
      setActions(res.actions);
      setError(null);
    } catch {
      setActions(null);
      setError("couldn't load the decision queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load, companyId]);

  const toggleEvidence = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!evidence[id]) {
      setEvidence((e) => ({ ...e, [id]: 'loading' }));
      try {
        const ev = await api.erp.actionEvidence(id);
        setEvidence((e) => ({ ...e, [id]: ev }));
      } catch {
        setEvidence((e) => ({ ...e, [id]: 'failed' }));
      }
    }
  };

  const act = async (id: string, kind: 'approve' | 'reject', code?: string) => {
    setBusyId(id);
    setMfaError(null);
    try {
      if (kind === 'approve') await api.catalysts.approveAction(id, 'ui', code);
      else await api.catalysts.rejectAction(id, 'ui', 'Rejected from the console', code);
      setStepUp(null);
      setMfaCode('');
      await load();
    } catch (e) {
      if (isStepUpRequired(e)) setStepUp({ id, kind });
      else if (e instanceof ApiError && e.status === 401 && code) setMfaError('Invalid code. Try again.');
      else setMfaError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const canApprove = persona?.canApprove !== false; // real tenants (persona null) → API decides
  const money = (v: number | null | undefined) => formatCompactCurrency(v ?? null, currency);

  return (
    <section id="decisions">
      <div className="head">
        <span className="kicker">Decisions</span>
        <h2>Waiting on you {actions && actions.length > 0 && <span className="meta">{actions.length} pending · {money(actions.reduce((s, a) => s + (a.value_zar || 0), 0))}</span>}</h2>
      </div>

      {loading && <p className="flow-note">Loading…</p>}
      {!loading && error && <p className="flow-note">— {error}</p>}
      {!loading && actions && actions.length === 0 && (
        <p className="flow-note">Nothing at the gate. New catalyst findings that need sign-off will pool here.</p>
      )}

      {actions?.map((a) => {
        const ev = evidence[a.id];
        return (
          <div key={a.id} className="decision">
            <button className="amt num" onClick={() => onAskJeff(`Pending action "${a.catalyst_name}" (${a.action_type}) worth ${money(a.value_zar)}`)}>
              {money(a.value_zar)}
            </button>
            <div className="what">
              <p><b>{a.catalyst_name}</b> — {a.action_type.replace(/_/g, ' ')}</p>
              <p className="sub">Raised {new Date(a.created_at).toLocaleDateString()}{a.reasoning ? ` · ${a.reasoning}` : ''}</p>
            </div>
            <div className="acts">
              <button className="ghost" onClick={() => toggleEvidence(a.id)}>
                {expandedId === a.id ? 'Hide evidence' : 'Evidence'}
              </button>
              <button
                className="go"
                disabled={!canApprove || busyId === a.id}
                style={!canApprove ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                title={!canApprove ? `${persona?.label} cannot approve — viewing only` : undefined}
                onClick={() => act(a.id, 'approve')}
              >
                {busyId === a.id ? '…' : 'Approve'}
              </button>
              <button
                className="ghost"
                disabled={!canApprove || busyId === a.id}
                style={!canApprove ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                title={!canApprove ? `${persona?.label} cannot reject — viewing only` : undefined}
                onClick={() => act(a.id, 'reject')}
              >
                Reject
              </button>
            </div>

            {stepUp?.id === a.id && (
              <div style={{ flexBasis: '100%' }} className="rc-sec">
                <span className="kicker">Step-up verification</span>
                <div className="acts">
                  <input
                    className="ai-in" style={{ maxWidth: '10rem' }}
                    value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && mfaCode.length === 6) act(a.id, stepUp.kind, mfaCode); }}
                    placeholder="6-digit code" inputMode="numeric" autoFocus
                  />
                  <button className="go" disabled={mfaCode.length !== 6 || busyId === a.id} onClick={() => act(a.id, stepUp.kind, mfaCode)}>
                    Confirm {stepUp.kind}
                  </button>
                  <button className="ghost" onClick={() => { setStepUp(null); setMfaCode(''); setMfaError(null); }}>Cancel</button>
                </div>
                {mfaError && <p className="flow-note" style={{ color: 'var(--bad)' }}>{mfaError}</p>}
              </div>
            )}
            {mfaError && stepUp?.id !== a.id && busyId === null && expandedId === a.id && (
              <p className="flow-note" style={{ flexBasis: '100%', color: 'var(--bad)' }}>{mfaError}</p>
            )}

            {expandedId === a.id && (
              <div style={{ flexBasis: '100%' }} className="rc-sec">
                {ev === 'loading' && <p className="flow-note">Loading evidence…</p>}
                {ev === 'failed' && <p className="flow-note">— couldn't load the evidence chain</p>}
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
            )}
          </div>
        );
      })}
    </section>
  );
}
