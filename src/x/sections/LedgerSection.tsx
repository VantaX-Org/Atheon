// Ledger: what the business got back, receipt by receipt.
// Recovered and prevented are API facts; the ROI multiple is the API's own
// reported number, never a formula computed on this screen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ForecastAccuracyResp, ProvenanceEntry, ProvenanceVerifyResult, ROITrackingResponse } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import type { Persona } from '../persona';
import { ledgerRiver } from '../flows';
import { MiniRiver } from '../MiniRiver';
import { SideDrawer } from '../SideDrawer';

type CompletedAction = Awaited<ReturnType<typeof api.erp.listAllActions>>['actions'][number];
type Evidence = Awaited<ReturnType<typeof api.erp.actionEvidence>>;
type CalibrationSummary = Awaited<ReturnType<typeof api.catalysts.getCalibrationSummary>>;
type ProvRoot = Awaited<ReturnType<typeof api.provenance.root>>;

export function LedgerSection({ onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void }) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [roi, setRoi] = useState<ROITrackingResponse | null>(null);
  const [receipts, setReceipts] = useState<CompletedAction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<Evidence | 'loading' | null>(null);
  // the sealed chain entry for the open receipt — binds THIS recovery to its
  // own seq/hash/signature. null = not yet sealed (honest, never fabricated).
  const [seal, setSeal] = useState<ProvenanceEntry | null>(null);
  const [busyExport, setBusyExport] = useState<'digest' | 'report' | 'csv' | null>(null);
  const [calib, setCalib] = useState<CalibrationSummary | null>(null);
  const [fcast, setFcast] = useState<ForecastAccuracyResp | null>(null);
  const [provRoot, setProvRoot] = useState<ProvRoot | null>(null);
  const [totals, setTotals] = useState<{ count: number; zar: number } | null>(null);
  // 'error' = verify call itself failed — distinct from a booked invalid result
  const [verify, setVerify] = useState<ProvenanceVerifyResult | 'running' | 'error' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [r, acts, cal, fa, pr, sum] = await Promise.allSettled([
        api.roi.get(),
        api.erp.listAllActions({ status: 'completed', limit: 200 }),
        api.catalysts.getCalibrationSummary(),
        api.insightsStats.forecastAccuracy(),
        api.provenance.root(),
        api.erp.actionsSummary(),
      ]);
      if (cancelled) return;
      setRoi(r.status === 'fulfilled' ? r.value : null);
      setReceipts(acts.status === 'fulfilled' ? acts.value.actions : null);
      // tenant-wide completed totals: the 'To date' terminal never sums a page
      setTotals(sum.status === 'fulfilled'
        ? { count: sum.value.summary.completed_count, zar: sum.value.summary.completed_value_zar }
        : null);
      setCalib(cal.status === 'fulfilled' ? cal.value : null);
      setFcast(fa.status === 'fulfilled' ? fa.value : null);
      setProvRoot(pr.status === 'fulfilled' ? pr.value : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const openReceipt = async (id: string) => {
    setReceipt('loading');
    setSeal(null);
    // evidence + this recovery's own chain entry, in parallel; a missing seal
    // just hides the seal block (not yet sealed), never blocks the receipt.
    const [ev, sl] = await Promise.allSettled([api.erp.actionEvidence(id), api.provenance.byAction(id)]);
    setReceipt(ev.status === 'fulfilled' ? ev.value : null);
    setSeal(sl.status === 'fulfilled' ? sl.value.entry : null);
  };

  const verifyChain = async () => {
    setVerify('running');
    try { setVerify(await api.provenance.verify()); }
    catch { setVerify('error'); }
  };

  // one busy slot: exports are sequential by nature; failures re-enable, no toast
  const runExport = async (kind: NonNullable<typeof busyExport>, fn: () => Promise<void>) => {
    setBusyExport(kind);
    try { await fn(); } catch { /* button re-enables; nothing downloaded */ }
    setBusyExport(null);
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const exportDigest = () => runExport('digest', async () => {
    const d = await api.boardDigest.generate();
    await api.boardDigest.downloadPdf(d.id, d.title);
  });

  const exportBoardReport = () => runExport('report', async () => {
    const r = await api.boardReport.generate();
    await api.boardReport.downloadPdf(r.id, r.title);
  });

  const exportCsv = () => runExport('csv', async () => {
    const { export: rows } = await api.roi.exportCsv();
    if (!rows?.length) return; // nothing booked → no file, button re-enables
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map((row) => keys.map((k) => esc(row[k])).join(','))].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'atheon-value-ledger.csv');
  });

  const money = useCallback((v: number | null | undefined) => formatCompactCurrency(v ?? null, currency), [currency]);
  const strip = useMemo(() => ledgerRiver(receipts, (v) => money(v), totals), [receipts, money, totals]);
  const recovered = roi?.totalDiscrepancyValueRecovered ?? null;
  const byConn = roi?.breakdown?.byConnection ?? [];
  // both trace to booked API fields; failed fetch → null → '—', never 0
  const accuracy = calib?.accuracyPct != null ? `${Math.round(calib.accuracyPct)}%` : '—';
  const withinBand = fcast?.within_band_rate != null ? `${(fcast.within_band_rate * 100).toFixed(1)}%` : '—';

  return (
    <section id="ledger">
      <div className="head">
        <span className="kicker">Ledger</span>
        <h2>What came back, receipt by receipt</h2>
        <Link className="drill" to="/x/findings">Every finding, line by line →</Link>
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
          <span className="kicker">Return multiple · reported</span>
          <button className="num" onClick={() => onAskJeff(`ROI multiple: ${roi?.roiMultiple != null ? `${roi.roiMultiple}×` : '—'} — the API's own reported number`)}>
            {loading ? '…' : roi?.roiMultiple != null ? `${roi.roiMultiple}×` : '—'}
          </button>
        </div>
        <div className="kpi">
          <span className="kicker">Sealed receipts</span>
          <button className="num" onClick={() => onAskJeff(`Sealed receipts: ${totals ? `${totals.count} completed actions worth ${money(totals.zar)}` : '—'}`)}>
            {loading ? '…' : totals != null ? totals.count : '—'}
          </button>
        </div>
      </div>
      {!loading && !roi && <p className="flow-note">— couldn't load the value ledger</p>}

      {!loading && <MiniRiver graph={strip} label="Booked recovery accumulating month by month into the to-date total" />}

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

        <div className="card" id="proof">
          <h3>Proof <span className="meta">forecast trust</span></h3>
          <div className="rowline">
            <button className="amt num" onClick={() => onAskJeff(`Forecast accuracy: ${accuracy} across ${calib ? `${calib.simulationsWithOutcomes} of ${calib.totalSimulations}` : 'observed'} simulations, ${calib?.calibratedSubCatalysts ?? '—'} calibrated sub-catalysts`)}>
              {loading ? '…' : accuracy}
            </button>
            <p><b>Forecast accuracy</b> — predicted vs booked
              {calib && <span className="when">{calib.simulationsWithOutcomes}/{calib.totalSimulations} simulations observed · {calib.calibratedSubCatalysts} calibrated</span>}
            </p>
          </div>
          <div className="rowline">
            <button className="amt num" onClick={() => onAskJeff(`Forecasts landing within band: ${withinBand}${fcast ? ` over ${fcast.total_graded} graded, last ${fcast.lookback_days} days` : ''}`)}>
              {loading ? '…' : withinBand}
            </button>
            <p><b>Within band</b> — forecasts that landed where promised
              {fcast && <span className="when">{fcast.total_graded} graded · last {fcast.lookback_days} days</span>}
            </p>
          </div>
          {provRoot?.root != null && (
            <button className="rc-hash" style={{ display: 'block', width: '100%', marginTop: '0.5rem' }}
              onClick={() => onAskJeff(`Provenance chain sealed at entry ${provRoot.seq}, merkle root ${provRoot.root}`)}>
              Provenance chain sealed · entry {provRoot.seq} · {provRoot.root.slice(0, 12)}…
            </button>
          )}
          <div className="acts" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
            <button className="ghost" onClick={verifyChain} disabled={verify === 'running'}>{verify === 'running' ? 'Verifying…' : 'Verify chain'}</button>
            {verify === 'error' && <span className="pill warn">couldn't verify</span>}
            {verify && typeof verify === 'object' && (
              verify.valid
                ? <span className="pill ok">chain intact · {verify.total_entries} entries</span>
                : <span className="pill warn">verification failed{verify.first_invalid_seq != null ? ` · entry ${verify.first_invalid_seq}` : ''}</span>
            )}
          </div>
        </div>

        <div className="card">
          <h3>Sealed exports <span className="meta">board-ready</span></h3>
          <p className="rc-meta">Every figure in these exports traces to the receipts below.</p>
          <div className="acts" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button className="go" onClick={exportDigest} disabled={busyExport === 'digest'}>{busyExport === 'digest' ? 'Preparing…' : 'Board digest PDF'}</button>
            <button className="ghost" onClick={exportBoardReport} disabled={busyExport === 'report'}>{busyExport === 'report' ? 'Preparing…' : 'Board report PDF'}</button>
            <button className="ghost" onClick={exportCsv} disabled={busyExport === 'csv'}>{busyExport === 'csv' ? 'Preparing…' : 'Ledger CSV'}</button>
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

      {receipt !== null && (
        <SideDrawer label="Receipt" head={<span className="seal"><i />Sealed receipt</span>} onClose={() => setReceipt(null)}>
          {receipt === 'loading' && <p className="flow-note">Loading receipt…</p>}
          {receipt !== 'loading' && (
            <>
              <p className="rc-title">{receipt.action.catalyst_name} — {receipt.action.action_type.replace(/_/g, ' ')}</p>
              <p className="rc-amt num">{money(receipt.action.value_zar)}</p>
              <p className="rc-id">{receipt.action.id}{receipt.action.approved_by ? ` · approved by ${receipt.action.approved_by}` : ''}</p>
              {seal ? (
                <div className="rc-sec">
                  <span className="kicker">Cryptographic seal</span>
                  <p className="rc-meta">This recovery is bound to chain entry <b>#{seal.seq}</b> — tamper any figure and the chain fails to re-derive.</p>
                  <p className="rc-hash" title="Payload hash — SHA-256 of this recovery's sealed record">hash {seal.payload_hash.slice(0, 24)}…</p>
                  {seal.signature && <p className="rc-hash" title="HMAC signature over the merkle root">sig {seal.signature.slice(0, 24)}…</p>}
                  <div className="acts" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                    <button className="ghost" onClick={verifyChain} disabled={verify === 'running'}>{verify === 'running' ? 'Verifying…' : 'Verify this seal'}</button>
                    {verify && typeof verify === 'object' && (
                      verify.valid
                        ? <span className="pill ok">chain intact · entry #{seal.seq} verified</span>
                        : <span className="pill warn">verification failed{verify.first_invalid_seq != null ? ` · entry ${verify.first_invalid_seq}` : ''}</span>
                    )}
                    {verify === 'error' && <span className="pill warn">couldn't verify</span>}
                  </div>
                </div>
              ) : (
                <p className="rc-meta">Not yet sealed to the provenance chain — sealing runs on reconciliation.</p>
              )}
              {receipt.finding && (
                <div className="rc-sec">
                  <span className="kicker">Source finding</span>
                  <p className="rc-meta"><b>{receipt.finding.title}</b> — {receipt.finding.description}</p>
                </div>
              )}
              {(receipt.execution_logs ?? []).length > 0 && (
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
        </SideDrawer>
      )}
    </section>
  );
}
