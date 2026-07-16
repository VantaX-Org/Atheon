// The heart of the console: the animated river of the business in the world.
// WORLD (external signals) → BUSINESS (health + operations) → OUTCOMES
// (leakage pooling at the gate, recovered value flowing back to the hub).
import { useEffect, useRef } from 'react';
import { useTenantCurrency } from '@/stores/appStore';
import { mountRiver } from './river';
import { buildReactorGraph, type ReactorFocus, type ReactorInput } from './reactor-graph';

const CONTEXT: Record<ReactorFocus, string> = {
  all: 'The world acting on your business, and what the recovery engine returns.',
  brief: 'External signals and where your operations leak value.',
  decisions: 'Leakage pooling at the gate — waiting on your decision.',
  ledger: 'Confirmed recoveries flowing back into the business.',
  catalysts: 'Catalysts working the flows between findings and the gate.',
};

const LEGEND: Array<{ label: string; token: string }> = [
  { label: 'Recovered', token: '--f-rec' },
  { label: 'At the gate', token: '--f-gate' },
  { label: 'Leakage', token: '--f-leak' },
  { label: 'In review', token: '--f-revw' },
  { label: 'Reversed', token: '--f-rev' },
];

export function Reactor({ input, focus, onAskJeff }: {
  input: ReactorInput;
  focus: ReactorFocus;
  onAskJeff: (nodeContext: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const currency = useTenantCurrency();

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { nodes, edges } = buildReactorGraph(input, currency, focus);
    return mountRiver(el, nodes, edges, {
      onNodeClick: (n) => {
        if (n.anchor) {
          document.getElementById(n.anchor)?.scrollIntoView({ behavior: 'smooth' });
          history.replaceState(null, '', `#${n.anchor}`);
        }
      },
      onAskJeff: (n) => onAskJeff(`${n.kicker}: ${n.value}${n.sub ? ` (${n.sub})` : ''}`),
    });
  }, [input, focus, currency, onAskJeff]);

  return (
    <div className="mscroll">
      <div ref={panelRef} className="flowpanel" role="img" aria-label="Live flow of external signals, operations leakage, and recovered value">
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
    </div>
  );
}
