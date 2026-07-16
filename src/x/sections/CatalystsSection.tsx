// Catalysts: the machines working the flows. Each card is a live catalyst
// cluster — trust, throughput, and what its runs have returned this period.
// Configure opens the shared drawer: per-sub-catalyst schedule and mode.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ClusterItem, ExecutionConfig, SubCatalyst, SubCatalystSchedule } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { catalystMiniRiver } from '../flows';
import { MiniRiver } from '../MiniRiver';
import { SideDrawer } from '../SideDrawer';
import type { Persona } from '../persona';

const MODES: ExecutionConfig['mode'][] = ['reconciliation', 'validation', 'extract', 'compare'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// One sub-catalyst's controls: enabled, mode, and when it runs. Every change
// saves immediately — the API's returned sub-catalyst is the source of truth.
function SubConfig({ clusterId, sub, onSaved }: {
  clusterId: string;
  sub: SubCatalyst;
  onSaved: (s: SubCatalyst) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sched = sub.schedule;

  const save = (p: Promise<{ success: boolean; subCatalyst: SubCatalyst }>) => {
    setBusy(true); setErr(null);
    p.then((r) => onSaved(r.subCatalyst))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setBusy(false));
  };

  const saveSchedule = (next: Partial<SubCatalystSchedule>) => {
    const merged = { frequency: sched?.frequency ?? 'manual', time_of_day: sched?.time_of_day ?? '02:00', ...sched, ...next };
    if (merged.frequency === 'manual') save(api.catalysts.removeSchedule(clusterId, sub.name));
    else save(api.catalysts.setSchedule(clusterId, sub.name, merged));
  };

  return (
    <div className="rc-sec cfg">
      <div className="rc-id">
        <label className="cfg-on">
          <input
            type="checkbox"
            checked={sub.enabled}
            disabled={busy}
            onChange={() => save(api.catalysts.toggleSubCatalyst(clusterId, sub.name))}
          />
          <b>{sub.name}</b>
        </label>
      </div>
      {sub.description && <p className="rc-meta">{sub.description}</p>}
      <div className="cfg-row">
        <label>Mode
          <select
            value={sub.execution_config?.mode ?? 'reconciliation'}
            disabled={busy}
            onChange={(e) => save(api.catalysts.setExecutionConfig(clusterId, sub.name, {
              mode: e.target.value as ExecutionConfig['mode'],
              parameters: sub.execution_config?.parameters,
            }))}
          >
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Runs
          <select
            value={sched?.frequency ?? 'manual'}
            disabled={busy}
            onChange={(e) => saveSchedule({ frequency: e.target.value as SubCatalystSchedule['frequency'] })}
          >
            <option value="manual">manually</option>
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </select>
        </label>
        {sched?.frequency === 'weekly' && (
          <label>On
            <select value={sched.day_of_week ?? 1} disabled={busy} onChange={(e) => saveSchedule({ day_of_week: Number(e.target.value) })}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        )}
        {sched?.frequency === 'monthly' && (
          <label>Day
            <select value={sched.day_of_month ?? 1} disabled={busy} onChange={(e) => saveSchedule({ day_of_month: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
        )}
        {sched && sched.frequency !== 'manual' && (
          <label>At
            <input
              type="time"
              value={sched.time_of_day ?? '02:00'}
              disabled={busy}
              onChange={(e) => saveSchedule({ time_of_day: e.target.value })}
            /> UTC
          </label>
        )}
      </div>
      {(sched?.next_run || sub.last_execution) && (
        <p className="rc-meta">
          {sched?.next_run ? `Next run ${new Date(sched.next_run).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          {sched?.next_run && sub.last_execution ? ' · ' : ''}
          {sub.last_execution ? `last ran ${new Date(sub.last_execution.executed_at).toLocaleDateString('en-ZA', { dateStyle: 'medium' })} (${sub.last_execution.status})` : ''}
        </p>
      )}
      {err && <p className="rc-meta cfg-err">{err}</p>}
    </div>
  );
}

type Ledger = Awaited<ReturnType<typeof api.catalysts.valueLedger>>;
type Runs = Awaited<ReturnType<typeof api.catalysts.runAnalytics>>;

export function CatalystsSection({ onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void }) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [clusters, setClusters] = useState<ClusterItem[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [loading, setLoading] = useState(true);
  const [cfgId, setCfgId] = useState<string | null>(null);
  const cfgCluster = clusters?.find((c) => c.id === cfgId) ?? null;

  const onSubSaved = (clusterId: string) => (s: SubCatalyst) =>
    setClusters((cs) => cs?.map((c) => c.id !== clusterId ? c : {
      ...c,
      subCatalysts: c.subCatalysts.map((x) => x.name === s.name ? s : x),
    }) ?? null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [cl, vl, ra] = await Promise.allSettled([
        api.catalysts.clusters(undefined, undefined, companyId ?? undefined),
        api.catalysts.valueLedger('last_90d', companyId ?? undefined),
        api.catalysts.runAnalytics(undefined, undefined, 10),
      ]);
      if (cancelled) return;
      setClusters(cl.status === 'fulfilled' ? cl.value.clusters : null);
      setLedger(vl.status === 'fulfilled' ? vl.value : null);
      setRuns(ra.status === 'fulfilled' ? ra.value : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const money = (v: number | null | undefined) => formatCompactCurrency(v ?? null, currency);
  // valueLedger rows are per sub-catalyst; roll up to cluster. Memoised so
  // each card's mini-river graph is a stable reference (the canvas remounts
  // on every new graph object).
  const { runValue, rivers } = useMemo(() => {
    const rv = new Map<string, { realized: number; runs: number }>();
    for (const c of ledger?.catalysts ?? []) {
      const cur = rv.get(c.clusterId) ?? { realized: 0, runs: 0 };
      rv.set(c.clusterId, { realized: cur.realized + c.realizedSavingsZar, runs: cur.runs + c.runsCount });
    }
    const max = Math.max(...[...rv.values()].map((v) => v.realized), 0);
    const rg = new Map<string, ReturnType<typeof catalystMiniRiver>>();
    for (const c of clusters ?? []) rg.set(c.id, catalystMiniRiver(rv.get(c.id) ?? null, max));
    return { runValue: rv, rivers: rg };
  }, [clusters, ledger]);

  return (
    <section id="catalysts">
      <div className="head">
        <span className="kicker">Catalysts</span>
        <h2>The machines working your flows
          {ledger?.summary && (
            <span className="meta"> {ledger.summary.totalRuns} runs · {money(ledger.summary.totalRealizedSavingsZar)} realised · last 90 days</span>
          )}
        </h2>
      </div>

      {loading && <p className="flow-note">Loading…</p>}
      {!loading && !clusters && <p className="flow-note">— couldn't load catalysts</p>}
      {!loading && clusters?.length === 0 && <p className="flow-note">No catalysts deployed yet.</p>}

      <div className="catgrid">
        {clusters?.map((c) => {
          const v = runValue.get(c.id);
          const river = rivers.get(c.id);
          return (
            <div key={c.id} className="cat">
              <h3>{c.name} <span className={`pill ${c.status === 'active' ? 'ok' : 'grey'}`}>{c.status}</span></h3>
              <p className="desc">{c.description}</p>
              {river && (
                <MiniRiver
                  graph={river}
                  className="mini"
                  label={v ? `Flow of realised value: ${money(v.realized)} over ${v.runs} runs, last 90 days` : 'No realised value flow yet'}
                />
              )}
              <div className="stats">
                <div className="s">
                  <span className="num">{c.tasksCompleted.toLocaleString()}</span>
                  <small>done{c.tasksInProgress > 0 ? ` · ${c.tasksInProgress} running` : ''}</small>
                </div>
                <div className="s">
                  <span className="num">{Math.round(c.successRate)}%</span>
                  <small>success</small>
                </div>
                <div className="s">
                  <span className="num">{Math.round(c.trustScore)}</span>
                  <small>trust · {c.autonomyTier}</small>
                </div>
                <div className="s blue">
                  <button className="num open" onClick={() => onAskJeff(`Catalyst "${c.name}" (${c.domain}): ${c.tasksCompleted} tasks done, ${Math.round(c.successRate)}% success, trust ${Math.round(c.trustScore)}${v ? `, realised ${money(v.realized)} over ${v.runs} runs last 90d` : ''}`)}>
                    {v ? money(v.realized) : '—'}
                  </button>
                  <small>{v ? `realised · ${v.runs} runs · 90d` : 'realised · 90d'}</small>
                </div>
              </div>
              {(c.subCatalysts ?? []).length > 0 && (
                <>
                  <p className="desc">{c.subCatalysts.length} sub-catalysts: {c.subCatalysts.slice(0, 4).map((s) => s.name).join(', ')}{c.subCatalysts.length > 4 ? '…' : ''}</p>
                  <button className="open" onClick={() => setCfgId(c.id)}>Schedule &amp; modes</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent runs — each row deep-links to the kept /catalysts/runs/:runId detail. */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Recent runs <span className="meta">last 10</span></h3>
        {runs ? (
          runs.runs.length === 0 ? <p className="flow-note">No runs yet.</p> : (
            <>
              <p className="rc-meta">
                {runs.aggregate.totalRuns} runs · {runs.aggregate.totalCompleted.toLocaleString()}/{runs.aggregate.totalItems.toLocaleString()} items completed · {runs.aggregate.totalExceptions} exceptions · {runs.aggregate.automationRate}% automated
              </p>
              {runs.runs.map((r) => (
                <Link key={r.id} to={`/catalysts/runs/${r.runId}`} className="lrow" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="d">{new Date(r.startedAt).toLocaleDateString()}</span>
                  <p><b>{r.subCatalystName ?? r.clusterName ?? '—'}</b> — {r.summary.completed}/{r.summary.total} completed{r.summary.exceptions > 0 ? ` · ${r.summary.exceptions} exceptions` : ''}</p>
                  <span className={`pill ${r.summary.exceptions > 0 ? 'warn' : r.status === 'completed' ? 'ok' : 'grey'}`}>{r.status.replace(/_/g, ' ')}</span>
                </Link>
              ))}
            </>
          )
        ) : (
          <p className="flow-note">{loading ? 'Loading…' : "— couldn't load recent runs"}</p>
        )}
      </div>

      {cfgCluster && (
        <SideDrawer
          label={`${cfgCluster.name} schedule and modes`}
          head={<span className="kicker">{cfgCluster.name}</span>}
          onClose={() => setCfgId(null)}
        >
          <div className="rc-title">Schedule &amp; modes</div>
          <p className="rc-meta">Each sub-catalyst runs in its own mode, on its own clock. Changes save immediately.</p>
          {cfgCluster.subCatalysts.map((s) => (
            <SubConfig key={s.name} clusterId={cfgCluster.id} sub={s} onSaved={onSubSaved(cfgCluster.id)} />
          ))}
        </SideDrawer>
      )}
    </section>
  );
}
