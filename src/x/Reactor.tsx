// The heart of the console: the animated river of the value chain. Stages
// across the top leak into the hub; recovery lands at the gold terminal,
// with the gate pooling until someone signs. Clicking any node opens the
// action sidebar; ✦ asks Jeff about it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/stores/appStore';
import { mountRiver, type RiverNode } from './river';
import { buildReactorGraph, REACTOR_LANES, type ChainStage, type ReactorFocus, type ReactorInput } from './reactor-graph';
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
  const closeSel = useCallback(() => setSel(null), []);

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

  const goTo = (anchor: string) => {
    setSel(null);
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', `#${anchor}`);
  };

  return (
    <div className="mscroll">
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
