import './tokens.css';

// Recovery Console — the org's own screen, and the one frontend. The
// recovered hero leads, the reactor (animated river of the business in the
// world) sits under it; Brief · Decisions · Ledger · Catalysts flow beneath.
// Shell pills scroll, never route; the scrollspy drives the pills and the
// reactor's focus lens. Everything else on the platform breaks out from the
// shell.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { formatZarFull } from '@/lib/format-currency';
import { Shell } from './Shell';
import { Reactor } from './Reactor';
import { useReactorInput } from './use-reactor-input';
import { activePersona, roleCanApprove, type PersonaKey } from './persona';
import type { SectionKey } from './reactor-graph';
import { BriefSection } from './sections/BriefSection';
import { DecisionsSection } from './sections/DecisionsSection';
import { LedgerSection } from './sections/LedgerSection';
import { CatalystsSection } from './sections/CatalystsSection';

export function ConsolePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // fresh login stores the tenant name on the user; activeTenantName is only
  // set when a multi-tenant user explicitly switches tenants
  const activeTenantName = useAppStore((s) => s.activeTenantName ?? s.user?.tenantName ?? null);
  const userRole = useAppStore((s) => s.user?.role);
  const { input, loading } = useReactorInput();
  const [active, setActive] = useState<SectionKey>('brief');
  const [jeff, setJeff] = useState<{ ctx: string; key: number }>({ ctx: '', key: 0 });

  // Decisions badge in the shell — same booked summary the reactor renders,
  // so the badge and the gate node can never disagree.
  const decisionsCount = input.gate?.pendingCount ?? null;

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

  // The role decides whether Approve renders enabled; the persona lens can only
  // grey further, never grant. The API stays the enforcement point.
  const canApprove = roleCanApprove(userRole) && (persona ? persona.canApprove : true);

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

      <main className="page">
        <div className="hero in">
          <div>
            <div className="kicker">{persona ? `Recovered · ${persona.lens}` : 'Recovered for your business'}</div>
            <div className="hero-big num">{loading ? '…' : formatZarFull(input.recovered?.zar)}</div>
            {input.sourceCount != null && (
              <span className="chip-up num">{input.sourceCount} source{input.sourceCount === 1 ? '' : 's'} connected · every figure from booked fields</span>
            )}
          </div>
          <div className="hero-side">
            <div className="s">
              <button
                className="num"
                onClick={() => { document.getElementById('leaks')?.scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', '#leaks'); }}
                title="Open the findings"
              >{formatZarFull(input.ops?.totalZar)}</button>
              <small>leakage detected · this assessment</small>
            </div>
            {input.recovered?.mult != null && input.recovered.mult > 0 && (
              <div className="s">
                <button className="num" onClick={() => onAskJeff(`ROI multiple ${Math.round(input.recovered!.mult!)}× (reported by the API)`)}>{Math.round(input.recovered.mult)}×</button>
                <small>return on the programme · reported</small>
              </div>
            )}
            <div className="s act">
              <button
                className="num"
                onClick={() => { document.getElementById('decisions')?.scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', '#decisions'); }}
                title="Open the decision queue"
              >{formatZarFull(input.gate?.pendingZar)}</button>
              <small>awaiting your signature</small>
            </div>
          </div>
        </div>

        <Reactor input={input} focus={active} opsFirst={persona?.opsFirst} canApprove={canApprove} loading={loading} chain={persona?.chain} onAskJeff={onAskJeff} />

        {sections.includes('brief') && <BriefSection persona={persona} onAskJeff={onAskJeff} />}
        {sections.includes('decisions') && <DecisionsSection persona={persona} canApprove={canApprove} onAskJeff={onAskJeff} />}
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
