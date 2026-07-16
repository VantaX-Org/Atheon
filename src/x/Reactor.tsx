// The heart of the console: the animated river of the value chain. Stages
// across the top leak into the hub; the recovery machine returns net-to-you
// after the Atheon fee, with the gate pooling until someone signs. Clicking
// any node opens the action sidebar; ✦ asks Jeff about it.
import { useEffect, useRef, useState } from 'react';
import { useTenantCurrency } from '@/stores/appStore';
import { mountRiver, type RiverNode } from './river';
import { buildReactorGraph, type ReactorFocus, type ReactorInput } from './reactor-graph';

const CONTEXT: Record<ReactorFocus, string> = {
  all: 'The value chain, where it leaks, and what the recovery engine returns.',
  brief: 'Where each stage of the value chain leaks, and what recovery returns.',
  decisions: 'Recoveries pooling at the gate — waiting on a signature.',
  ledger: 'Recovered value: net to you after the Atheon fee.',
  catalysts: 'Catalysts working the leaks between the stages and the gate.',
};

const LEGEND: Array<{ label: string; token: string }> = [
  { label: 'Recovered', token: '--f-rec' },
  { label: 'Atheon fee', token: '--f-fee' },
  { label: 'At the gate', token: '--f-gate' },
  { label: 'Leakage', token: '--f-leak' },
  { label: 'In review', token: '--f-revw' },
  { label: 'Reversed', token: '--f-rev' },
];

const ANCHOR_LABEL: Record<string, string> = {
  brief: 'the brief', leaks: 'the findings', decisions: 'the decision queue',
  ledger: 'the ledger', catalysts: 'the catalysts',
};

export function Reactor({ input, focus, opsFirst, onAskJeff }: {
  input: ReactorInput;
  focus: ReactorFocus;
  opsFirst?: string[];
  onAskJeff: (nodeContext: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const currency = useTenantCurrency();
  const [sel, setSel] = useState<RiverNode | null>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { nodes, edges } = buildReactorGraph(input, currency, focus, opsFirst);
    return mountRiver(el, nodes, edges, {
      onNodeClick: setSel,
      onAskJeff: (n) => onAskJeff(`${n.kicker}: ${n.value}${n.sub ? ` (${n.sub})` : ''}`),
    });
  }, [input, focus, currency, opsFirst, onAskJeff]);

  const goTo = (anchor: string) => {
    setSel(null);
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', `#${anchor}`);
  };

  return (
    <div className="mscroll">
      <div ref={panelRef} className="flowpanel" role="img" aria-label="Live flow of the value chain: stage leakage, the decision gate, and recovered value net of fee">
        <canvas />
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
        <>
          <div className="scrim" style={{ opacity: 1, pointerEvents: 'auto' }} onClick={() => setSel(null)} />
          <aside className="drawer" style={{ transform: 'none' }} aria-label={`${sel.kicker} actions`}>
            <div className="drawer-head">
              <span className="kicker">{sel.kicker}</span>
              <button className="drawer-close" onClick={() => setSel(null)} aria-label="Close">✕</button>
            </div>
            <div className="rc-amt num">{sel.value}</div>
            {sel.sub && <p className="rc-meta">{sel.sub}</p>}
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
                ✦ Ask Jeff about this
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
