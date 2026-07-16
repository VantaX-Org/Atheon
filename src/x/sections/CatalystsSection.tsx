// Catalysts: the machines working the flows. Each card is a live catalyst
// cluster — trust, throughput, and what its runs have returned this period.
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ClusterItem } from '@/lib/api';
import { useSelectedCompanyId, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { catalystMiniRiver } from '../flows';
import { MiniRiver } from '../MiniRiver';
import type { Persona } from '../persona';

type Ledger = Awaited<ReturnType<typeof api.catalysts.valueLedger>>;

export function CatalystsSection({ onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void }) {
  const companyId = useSelectedCompanyId();
  const currency = useTenantCurrency();
  const [clusters, setClusters] = useState<ClusterItem[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [cl, vl] = await Promise.allSettled([
        api.catalysts.clusters(undefined, undefined, companyId ?? undefined),
        api.catalysts.valueLedger('last_90d', companyId ?? undefined),
      ]);
      if (cancelled) return;
      setClusters(cl.status === 'fulfilled' ? cl.value.clusters : null);
      setLedger(vl.status === 'fulfilled' ? vl.value : null);
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
                <p className="desc">{c.subCatalysts.length} sub-catalysts: {c.subCatalysts.slice(0, 4).map((s) => s.name).join(', ')}{c.subCatalysts.length > 4 ? '…' : ''}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
