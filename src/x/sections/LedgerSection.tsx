// Ledger: the commercial layer between Vantax and the customer.
// Recovered and prevented are API facts; the platform fee is shown on its own
// line (never netted into recovered); net is computed client-side and says so.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ROITrackingResponse } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import type { Persona } from '../persona';

type CompletedAction = Awaited<ReturnType<typeof api.erp.listAllActions>>['actions'][number];
type Evidence = Awaited<ReturnType<typeof api.erp.actionEvidence>>;

export function LedgerSection({ persona: _persona, onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void }) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [roi, setRoi] = useState<ROITrackingResponse | null>(null);
  const [receipts, setReceipts] = useState<CompletedAction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<Evidence | 'loading' | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [r, acts] = await Promise.allSettled([
        api.roi.get(),
        api.erp.listAllActions({ status: 'completed', limit: 20 }),
      ]);
      if (cancelled) return;
      setRoi(r.status === 'fulfilled' ? r.value : null);
      setReceipts(acts.status === 'fulfilled' ? acts.value.actions : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // .drawer/.scrim open via the receipt-open class on the .rx root
  useEffect(() => {
    const root = document.querySelector('.rx');
    root?.classList.toggle('receipt-open', receipt !== null);
    return () => root?.classList.remove('receipt-open');
  }, [receipt]);

  const openReceipt = async (id: string) => {
    setReceipt('loading');
    try { setReceipt(await api.erp.actionEvidence(id)); }
    catch { setReceipt(null); }
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const blob = await api.roi.exportPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'atheon-value-ledger.pdf'; a.click();
      URL.revokeObjectURL(url);
    } catch { /* button re-enables; nothing downloaded */ }
    setExporting(false);
  };

  const money = (v: number | null | undefined) => formatCompactCurrency(v ?? null, currency);
  const recovered = roi?.totalDiscrepancyValueRecovered ?? null;
  const fee = roi?.platformCost ?? null;
  const net = recovered != null && fee != null ? recovered - fee : null;
  const byConn = roi?.breakdown?.byConnection ?? [];

  return (
    <section id="ledger">
      <div className="head">
        <span className="kicker">Ledger</span>
        <h2>What came back, and what it cost</h2>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kicker">Recovered</span>
          <button className="num" onClick={() => onAskJeff(`Recovered to date: ${money(recovered)}`)}>{loading ? '…' : money(recovered)}</button>
        </div>
        <div className="kpi">
          <span className="kicker">Losses prevented</span>
          <button className="num" onClick={() => onAskJeff(`Prevented losses: ${money(roi?.totalPreventedLosses)}`)}>{loading ? '…' : money(roi?.totalPreventedLosses)}</button>
        </div>
        <div className="kpi">
          <span className="kicker">Platform fee</span>
          <button className="num" onClick={() => onAskJeff(`Platform fee: ${money(fee)} — shown separately, never netted from recovered`)}>{loading ? '…' : money(fee)}</button>
        </div>
        <div className="kpi">
          <span className="kicker">Net to you · computed</span>
          <button className="num" onClick={() => onAskJeff(`Net = recovered ${money(recovered)} minus fee ${money(fee)} = ${money(net)}${roi ? `, ${roi.roiMultiple}× return` : ''}`)}>
            {loading ? '…' : money(net)}{roi?.roiMultiple != null && <small style={{ fontSize: '0.75rem', color: 'var(--faint)' }}> · {roi.roiMultiple}×</small>}
          </button>
        </div>
      </div>
      {!loading && !roi && <p className="flow-note">— couldn't load the value ledger</p>}

      <div className="cards">
        <div className="card" id="attribution">
          <h3>Where recovery came from <span className="meta">by source system</span></h3>
          {byConn.length > 0 ? byConn.map((c) => (
            <div key={c.key} className="rowline">
              <button className="amt num" onClick={() => onAskJeff(`${c.label}: ${money(c.recoveredValue)} recovered from ${c.inputRecords.toLocaleString()} records`)}>
                {money(c.recoveredValue)}
              </button>
              <p><b>{c.label}</b> — {Math.round(c.share * 100)}% of recovery
                <span className="when">{c.inputRecords.toLocaleString()} records · {money(c.inputValue)} processed</span>
              </p>
            </div>
          )) : (
            <p className="flow-note">{loading ? 'Loading…' : '— no attribution data yet'}</p>
          )}
        </div>

        <div className="card">
          <h3>Sealed exports <span className="meta">board-ready</span></h3>
          <p className="rc-meta">Every figure in these exports traces to the receipts below.</p>
          <div className="acts" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="go" onClick={exportPdf} disabled={exporting}>{exporting ? 'Preparing…' : 'Value ledger PDF'}</button>
            <Link className="ghost" to="/board" style={{ display: 'inline-flex', alignItems: 'center' }}>Board digest</Link>
          </div>
        </div>
      </div>

      <div className="card" id="receipts" style={{ marginTop: '1rem' }}>
        <h3>Receipts <span className="meta">completed actions</span></h3>
        {receipts ? (
          receipts.length === 0 ? <p className="flow-note">No completed actions yet.</p> :
          receipts.map((a) => (
            <div key={a.id} className="lrow">
              <span className="d">{new Date(a.completed_at ?? a.created_at).toLocaleDateString()}</span>
              <p><b>{a.catalyst_name}</b> — {a.action_type.replace(/_/g, ' ')}</p>
              <button className="amt num" onClick={() => openReceipt(a.id)}>
                {money(a.value_zar)}<span className="seal-ic">● sealed</span>
              </button>
            </div>
          ))
        ) : (
          <p className="flow-note">{loading ? 'Loading…' : "— couldn't load receipts"}</p>
        )}
      </div>

      <div className="scrim" onClick={() => setReceipt(null)} />
      <div className="drawer" role="dialog" aria-label="Receipt">
        {receipt === 'loading' && <p className="flow-note">Loading receipt…</p>}
        {receipt && receipt !== 'loading' && (
          <>
            <div className="drawer-head">
              <span className="seal"><i />Sealed receipt</span>
              <button className="drawer-close" onClick={() => setReceipt(null)} aria-label="Close">✕</button>
            </div>
            <p className="rc-title">{receipt.action.catalyst_name} — {receipt.action.action_type.replace(/_/g, ' ')}</p>
            <p className="rc-amt num">{money(receipt.action.value_zar)}</p>
            <p className="rc-id">{receipt.action.id}{receipt.action.approved_by ? ` · approved by ${receipt.action.approved_by}` : ''}</p>
            {receipt.action.idempotency_key && <p className="rc-hash">{receipt.action.idempotency_key}</p>}
            {receipt.finding && (
              <div className="rc-sec">
                <span className="kicker">Source finding</span>
                <p className="rc-meta"><b>{receipt.finding.title}</b> — {receipt.finding.description}</p>
              </div>
            )}
            {receipt.execution_logs.length > 0 && (
              <div className="rc-sec">
                <span className="kicker">Execution</span>
                <table className="rc-table">
                  <thead><tr><th>Step</th><th>Status</th></tr></thead>
                  <tbody>
                    {receipt.execution_logs.map((l) => (
                      <tr key={l.id}><td>{l.step_number}. {l.step_name}</td><td>{l.status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="rc-meta">
              Raised {new Date(receipt.action.created_at).toLocaleString()}
              {receipt.action.completed_at ? ` · completed ${new Date(receipt.action.completed_at).toLocaleString()}` : ''}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
