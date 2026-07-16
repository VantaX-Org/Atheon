import './tokens.css';

// Recovery Console — one cohesive screen. The reactor (animated river of the
// business in the world) sits on top; Brief · Decisions · Ledger · Catalysts
// flow beneath it. Shell pills and the left rail scroll, never route; the
// scrollspy drives both the rail highlight and the reactor's focus lens.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { Shell } from './Shell';
import { Reactor } from './Reactor';
import { XIcon } from './icons';
import { useReactorInput } from './use-reactor-input';
import { activePersona, type PersonaKey } from './persona';
import type { SectionKey } from './reactor-graph';
import { BriefSection } from './sections/BriefSection';
import { DecisionsSection } from './sections/DecisionsSection';
import { LedgerSection } from './sections/LedgerSection';
import { CatalystsSection } from './sections/CatalystsSection';

const RAIL: Array<{ id: string; label: string; section: SectionKey; sub?: boolean }> = [
  { id: 'brief', label: 'Brief', section: 'brief' },
  { id: 'world', label: 'The world', section: 'brief', sub: true },
  { id: 'plumbing', label: 'The plumbing', section: 'brief', sub: true },
  { id: 'leaks', label: 'Where it leaks', section: 'brief', sub: true },
  { id: 'decisions', label: 'Decisions', section: 'decisions' },
  { id: 'ledger', label: 'Ledger', section: 'ledger' },
  { id: 'attribution', label: 'Attribution', section: 'ledger', sub: true },
  { id: 'receipts', label: 'Receipts', section: 'ledger', sub: true },
  { id: 'catalysts', label: 'Catalysts', section: 'catalysts' },
];

const SECTION_ICON = { brief: 'brief', decisions: 'decisions', ledger: 'ledger', catalysts: 'catalysts' } as const;

export function ConsolePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTenantName = useAppStore((s) => s.activeTenantName);
  const { input } = useReactorInput();
  const [active, setActive] = useState<SectionKey>('brief');
  const [decisionsCount, setDecisionsCount] = useState<number | null>(null);
  const [jeff, setJeff] = useState<{ ctx: string; key: number }>({ ctx: '', key: 0 });

  const persona = useMemo(
    () => activePersona(searchParams.toString(), activeTenantName),
    [searchParams, activeTenantName],
  );
  const sections = useMemo(
    () => persona?.sections ?? (['brief', 'decisions', 'ledger', 'catalysts'] as SectionKey[]),
    [persona],
  );

  const onPersona = (k: PersonaKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('as', k);
    setSearchParams(next, { replace: true });
  };

  const onAskJeff = useCallback((ctx: string) => {
    setJeff((j) => ({ ctx: `surface:/x node:${ctx}`, key: j.key + 1 }));
  }, []);

  // Decisions badge in the shell — count only, the section owns the queue.
  useEffect(() => {
    api.erp.listAllActions({ status: 'pending_approval', limit: 50 })
      .then((r) => setDecisionsCount(r.total ?? r.actions.length))
      .catch(() => setDecisionsCount(null));
  }, []);

  // Scrollspy: the topmost visible section drives rail, pills, and reactor lens.
  useEffect(() => {
    const els = sections.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const visible = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) setActive(best[0] as SectionKey);
    }, { rootMargin: '-20% 0px -40% 0px', threshold: [0, 0.25, 0.5] });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  // #hash deep link scrolls once the sections exist.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <div className="rx">
      <Shell
        active={active}
        persona={persona}
        onPersona={onPersona}
        decisionsCount={decisionsCount}
        jeffContext={jeff.ctx ? `role:${persona?.key ?? 'user'} ${jeff.ctx}` : undefined}
        jeffOpenKey={jeff.key}
      />

      <nav className="rail" aria-label="On this page">
        {RAIL.filter((r) => sections.includes(r.section)).map((r) => (
          <button
            key={r.id}
            className={r.sub ? 'sub' : undefined}
            aria-current={!r.sub && active === r.section ? 'true' : undefined}
            onClick={() => scrollTo(r.id)}
          >
            {!r.sub && <XIcon name={SECTION_ICON[r.section]} size={14} />}
            {r.label}
          </button>
        ))}
      </nav>

      <main className="page">
        <div className="head">
          <h1>{persona ? persona.lens : 'The business, live'}</h1>
          <p className="why">{persona ? persona.kicker : 'Everything on this screen traces to a booked API field.'}</p>
        </div>

        <Reactor input={input} focus={active} onAskJeff={onAskJeff} />

        {sections.includes('brief') && <BriefSection persona={persona} onAskJeff={onAskJeff} />}
        {sections.includes('decisions') && <DecisionsSection persona={persona} onAskJeff={onAskJeff} />}
        {sections.includes('ledger') && <LedgerSection persona={persona} onAskJeff={onAskJeff} />}
        {sections.includes('catalysts') && <CatalystsSection persona={persona} onAskJeff={onAskJeff} />}

        <p className="footnote">
          Every figure on this screen traces to a booked API field; a dash means
          the source has not reported. AI commentary is marked and attributed.
        </p>
      </main>
    </div>
  );
}
