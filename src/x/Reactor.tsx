// The heart of the console: the animated river of the value chain. Stages
// across the top leak into the hub; recovery lands at the gold terminal,
// with the gate pooling until someone signs. Clicking any node opens the
// action sidebar; ✦ asks Jeff about it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import type { SignalImpact } from '@/lib/api';
import { mountRiver, type RiverNode } from './river';
import { BUCKET_DIM, buildReactorGraph, REACTOR_LANES, type ChainStage, type ReactorFocus, type ReactorInput } from './reactor-graph';
import { SideDrawer } from './SideDrawer';

const CONTEXT: Record<ReactorFocus, string> = {
  all: 'The value chain, where it leaks, and what the business gets back.',
  brief: 'Where each stage of the value chain leaks, and what recovery returns.',
  decisions: 'Recoveries pooling at the gate — waiting on a signature.',
  ledger: 'Recovered value, booked back to the business — sealed receipts only.',
  catalysts: 'Catalysts working the leaks between the stages and the gate.',
};

const LEGEND: Array<{ label: string; token: string }> = [
  { label: 'Recovered', token: '--f-rec' },
  { label: 'At the gate', token: '--f-gate' },
  { label: 'Leakage', token: '--f-leak' },
  { label: 'In review', token: '--f-revw' },
  { label: 'Rejected/failed', token: '--f-rev' },
];

const ANCHOR_LABEL: Record<string, string> = {
  brief: 'the brief', leaks: 'the findings', decisions: 'the decision queue',
  ledger: 'the ledger', catalysts: 'the catalysts',
};

const DIM_LABEL: Record<string, string> = {
  financial: 'Financial', revenue: 'Revenue', supply_chain: 'Supply chain',
  compliance: 'Compliance', operational: 'Operations',
};
const TIMELINE_LABEL: Record<string, string> = {
  immediate: 'immediate', 'near-term': 'near term', strategic: 'strategic',
};

export function Reactor({ input, focus, opsFirst, canApprove, loading, chain, onAskJeff }: {
  input: ReactorInput;
  focus: ReactorFocus;
  opsFirst?: string[];
  canApprove?: boolean;
  loading?: boolean;
  chain?: ChainStage[];
  onAskJeff: (nodeContext: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const currency = useTenantCurrency();
  const [sel, setSel] = useState<RiverNode | null>(null);
  const [prov, setProv] = useState<{ root: string | null; seq: number; created_at: string | null } | null>(null);
  const [impacts, setImpacts] = useState<Array<SignalImpact & { signalTitle: string }> | null>(null);
  const closeSel = useCallback(() => setSel(null), []);

  // Macro drawer: fetch the computed business impact per live signal. Empty
  // impacts (engine has not attributed) → no section, never an invented one.
  useEffect(() => {
    if (sel?.id !== 'macro' || !input.macro?.signals.length) { setImpacts(null); return; }
    let on = true;
    Promise.allSettled(input.macro.signals.map((s) => api.radar.signalImpact(s.id))).then((rs) => {
      if (!on) return;
      setImpacts(rs.flatMap((r, i) => r.status === 'fulfilled'
        ? r.value.impacts.map((im) => ({ ...im, signalTitle: input.macro!.signals[i].title }))
        : []));
    });
    return () => { on = false; };
  }, [sel, input.macro]);

  // Transaction-grounded exposure: sum live finding value in the value-chain
  // stages whose health dimension this impact hits. Null → line omitted.
  const exposureFor = (dim: string): number | null => {
    const v = (input.ops?.categories ?? [])
      .filter((c) => BUCKET_DIM[c.key] === dim)
      .reduce((a, c) => a + c.valueZar, 0);
    return v > 0 ? v : null;
  };

  // Seal the drawer with the live audit-chain root; a null root simply omits
  // the seal block — never a fabricated hash.
  useEffect(() => {
    if (!sel?.sealed) return;
    let on = true;
    api.provenance.root().then((r) => { if (on) setProv(r); }).catch(() => { if (on) setProv(null); });
    return () => { on = false; };
  }, [sel]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || loading) return; // hold the river until the ledger has reported
    const { nodes, edges } = buildReactorGraph(input, currency, focus, opsFirst, canApprove, chain);
    return mountRiver(el, nodes, edges, {
      lanes: focus === 'all' || focus === 'brief' ? REACTOR_LANES : undefined,
      onNodeClick: setSel,
      onAskJeff: (n) => onAskJeff(`${n.kicker}: ${n.value}${n.sub ? ` (${n.sub})` : ''}`),
    });
  }, [input, focus, currency, opsFirst, canApprove, chain, loading, onAskJeff]);

  // Ticker click drills into the macro node: rebuild the graph (pure, cheap)
  // and open its drawer — same rows the head tile shows.
  const openMacro = () => {
    const { nodes } = buildReactorGraph(input, currency, focus, opsFirst, canApprove, chain);
    const m = nodes.find((n) => n.id === 'macro');
    if (m) setSel(m);
  };
  const SENT: Record<string, string> = { positive: 'pos', negative: 'neg' };

  const goTo = (anchor: string) => {
    setSel(null);
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', `#${anchor}`);
  };

  return (
    <div className="mscroll">
      {!!input.macro?.signals.length && (
        <button className="ticker" onClick={openMacro} aria-label={`${input.macro.count} live external signals — open details`}>
          <span className="tk-live"><i />Live signals</span>
          <span className="tk-tape" aria-hidden="true">
            {/* duplicated run = seamless loop; screen readers get the count above */}
            {[0, 1].map((run) => (
              <span className="tk-run" key={run}>
                {input.macro!.signals.map((s, i) => (
                  <span className={`tk-item ${SENT[s.sentiment] ?? ''}`} key={i}>
                    <b>●</b> {s.title}{s.source ? ` — ${s.source}` : ''}
                  </span>
                ))}
              </span>
            ))}
          </span>
        </button>
      )}
      {/* role=group: the tiles inside are real buttons — img would hide them from AT */}
      <div ref={panelRef} className={`flowpanel${loading ? ' loading' : ''}`} role="group" aria-busy={loading || undefined} aria-label="Live flow of the value chain: stage leakage, the decision gate, and recovered value">
        <canvas aria-hidden="true" />
        {loading && <span className="flow-loading">Reading the ledger…</span>}
      </div>
      <p className="flow-note">
        {CONTEXT[focus]}
        <span className="legend">
          {LEGEND.map((l) => (
            <span key={l.token} className="legend-chip">
              <i style={{ background: `var(${l.token})` }} /> {l.label}
            </span>
          ))}
        </span>
      </p>

      {sel && (
        <SideDrawer
          label={`${sel.kicker} details`}
          head={sel.sealed && prov?.root
            ? <span className="seal"><i />Sealed receipt</span>
            : <span className="kicker">{sel.kicker}</span>}
          onClose={closeSel}
        >
          {sel.sealed && prov?.root && <div className="kicker">{sel.kicker}</div>}
          <div className="rc-amt num">{sel.value}</div>
          {sel.sub && <p className="rc-meta">{sel.sub}</p>}
          {sel.trend && (
            <p className={`rc-trend ${sel.trend.dir}`}>
              {sel.trend.dir === 'up' ? '▲' : sel.trend.dir === 'down' ? '▼' : '●'} Health {sel.trend.score}/100
              {' · '}{sel.trend.dir === 'up' ? 'improving' : sel.trend.dir === 'down' ? 'declining' : 'steady'}
              {sel.trend.delta != null && ` (${sel.trend.delta > 0 ? '+' : ''}${sel.trend.delta} this period)`}
            </p>
          )}
          {sel.sealed && prov?.root && (
            <div className="rc-sec">
              <div className="rc-id">Audit chain · seq {prov.seq}</div>
              <div className="rc-hash num">{prov.root}</div>
              <p className="rc-meta">
                chained &amp; sealed{prov.created_at ? ` · ${new Date(prov.created_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
              </p>
            </div>
          )}
          {!!sel.rows?.length && (
            <div className="rc-sec">
              <div className="rc-id">Inside this figure</div>
              {sel.rows.map((r) => (
                <div key={r.label} className="rc-row">
                  <span className="rc-row-l">{r.label}{r.sub && <em>{r.sub}</em>}</span>
                  <span className="num">{r.value}</span>
                </div>
              ))}
            </div>
          )}
          {sel.id === 'macro' && !!impacts?.length && (
            <div className="rc-sec">
              <div className="rc-id">Potential business impact</div>
              {impacts.map((im) => {
                const exp = exposureFor(im.healthDimension);
                return (
                  <div key={im.id} className="rc-imp">
                    <p className={`rc-imp-h ${im.impactDirection === 'tailwind' ? 'up' : 'down'}`}>
                      {im.impactDirection === 'tailwind' ? '▲ Tailwind' : '▼ Headwind'}
                      {' · '}{DIM_LABEL[im.healthDimension] ?? im.healthDimension}
                      {' · '}{TIMELINE_LABEL[im.impactTimeline] ?? im.impactTimeline}
                    </p>
                    <p className="rc-meta">{im.signalTitle}</p>
                    {exp != null && (
                      <p className="rc-imp-exp num">
                        ≈ {formatCompactCurrency(exp, currency)} in open findings across the stages this hits
                      </p>
                    )}
                    {im.recommendedResponse && <p className="rc-meta">{im.recommendedResponse}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {!!sel.downstream?.length && (
            <div className="rc-sec">
              <div className="rc-id">Impact downstream</div>
              {sel.downstream.map((r) => (
                <div key={r.label} className="rc-row">
                  <span className="rc-row-l">{r.label}{r.sub && <em>{r.sub}</em>}</span>
                  <span className="num">{r.value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="rc-sec">
            <div className="rc-id">Provenance</div>
            <p className="rc-meta">
              {sel.prov ?? 'Read live from a booked API field — never estimated, never invented. A dash means the source has not reported.'}
            </p>
          </div>
          <div className="rc-sec">
            {sel.anchor && (
              <button className="go" onClick={() => goTo(sel.anchor!)}>
                Open {ANCHOR_LABEL[sel.anchor] ?? sel.anchor}
              </button>
            )}
            <button
              className="ghost"
              onClick={() => { onAskJeff(`${sel.kicker}: ${sel.value}${sel.sub ? ` (${sel.sub})` : ''}`); setSel(null); }}
            >
              ✦ Explain in plain language
            </button>
          </div>
        </SideDrawer>
      )}
    </div>
  );
}
