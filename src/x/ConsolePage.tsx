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
import { api } from '@/lib/api';
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

// Jeff's login brief: role-aware, generated once per persona per session (Jeff
// is slow and priced — the cache stops persona flips from re-billing). AI
// commentary, marked as Jeff's. A failed call renders nothing — never canned text.
const briefCache = new Map<string, string>();

function JeffBrief({ personaKey, personaLabel }: { personaKey: string; personaLabel: string }) {
  const [text, setText] = useState<string | null>(briefCache.get(personaKey) ?? null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(briefCache.has(personaKey) ? Infinity : 0);

  useEffect(() => {
    const cached = briefCache.get(personaKey);
    if (cached) { setText(cached); setShown(Infinity); setFailed(false); return; }
    setText(null); setShown(0); setFailed(false);
    let on = true;
    api.mind.query(
      `Brief the ${personaLabel} in exactly three short sentences: what the recovery programme has returned to date, the single biggest leak right now, and the one decision that most needs their attention today. Plain prose — no lists, no headings, no preamble.`,
      'tier-1',
    ).then((r) => {
      if (!on) return;
      briefCache.set(personaKey, r.response);
      setText(r.response);
    }).catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [personaKey, personaLabel]);

  // typewriter reveal — presentational only; reduced-motion users get it whole
  useEffect(() => {
    if (!text || shown >= text.length) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(Infinity); return; }
    const t = setInterval(() => setShown((s) => s + 3), 24);
    return () => clearInterval(t);
  }, [text, shown]);

  if (failed) return null;
  return (
    <div className="jeff-brief in" aria-live="polite">
      <span className="jb-tag">✦ Jeff · AI brief</span>
      {text
        ? <p>{shown >= text.length ? text : text.slice(0, shown)}</p>
        : <p className="jb-wait">Jeff is reading your ledger and preparing today&apos;s brief…</p>}
    </div>
  );
}

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
        jeffContext={jeff.ctx ? `${persona ? `The reader is the ${persona.label} — answer through their lens (${persona.lens}). ` : ''}${jeff.ctx}` : undefined}
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
            {(input.pulse || input.health) && (
              <button
                className="pulse-strip num"
                onClick={() => { document.getElementById('brief')?.scrollIntoView({ behavior: 'smooth' }); history.replaceState(null, '', '#brief'); }}
                title="Open the brief"
              >
                <span className="ps-k">Since last period</span>
                {input.health && (
                  <span>
                    health {input.health.overall}
                    {input.pulse?.healthDelta != null && (
                      <em className={input.pulse.healthDelta >= 0 ? 'up' : 'down'}>
                        {' '}{input.pulse.healthDelta >= 0 ? '▲' : '▼'}{Math.abs(input.pulse.healthDelta)}
                      </em>
                    )}
                  </span>
                )}
                {input.pulse?.redMetricCount != null && <span><em className="down">{input.pulse.redMetricCount}</em> metrics red</span>}
                {input.pulse?.anomalyCount != null && <span><em className="down">{input.pulse.anomalyCount}</em> open anomalies</span>}
                {input.pulse?.activeRiskCount != null && <span><em className="down">{input.pulse.activeRiskCount}</em> risk alerts</span>}
              </button>
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

        <JeffBrief personaKey={persona?.key ?? 'user'} personaLabel={persona?.label ?? 'executive team'} />

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
