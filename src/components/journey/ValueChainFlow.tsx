/**
 * ValueChainFlow — the signature graphic. The five-stage value chain runs across
 * the top (Data → Findings → Fixes → Savings → Reports); a canvas "river" flows
 * beneath it left-to-right, leaking amber where exposure is open, pooling blue
 * where fixes await a signature, and landing green where money is recovered.
 *
 * The river is DECORATIVE (aria-hidden) and QUALITATIVE — it never encodes a
 * magnitude. Every claimed number lives in the node labels, which are gated by
 * the honesty law (null field → em-dash, no claim). A segment only animates when
 * its underlying field is present and non-zero, so the motion never implies data
 * that isn't there.
 *
 * Self-fetching via useJourneyInput so any page mounts it as a one-liner:
 * <ValueChainFlow focus="detect" />. The focused stage expands into the page's
 * centrepiece — wider column, a context line built from the live variables, and
 * the stage CTA — so the same graphic reads differently on every page.
 */
import '@/x/tokens.css';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAppStore, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { stageAccessible, type JourneyStage, type StageInput, type StageKey } from '@/lib/journey';
import { useJourneyInput } from '@/lib/use-journey-input';
import { mountRiver } from '@/x/river';
import { valueChainRiver } from '@/x/flows';
import { cn } from '@/lib/utils';

interface Activity { flow: boolean; leak: boolean; pool: boolean; land: boolean; }

/**
 * One narrative line for the focused stage, built ONLY from fetched variables —
 * it changes as the numbers change and stays silent (null) when a fetch failed.
 */
function contextFor(key: StageKey, input: StageInput | null, currency: string): string | null {
  if (!input) return null;
  const money = (v: number) => formatCompactCurrency(v, currency);
  switch (key) {
    case 'connect': {
      const c = input.connections;
      if (!c) return null;
      if (c.broken > 0) return `${c.broken} source${c.broken === 1 ? ' is' : 's are'} broken — findings go stale until reconnected.`;
      return c.total > 0 ? 'All sources flowing — detection runs on live ERP data.' : 'Nothing connected yet — the loop starts here.';
    }
    case 'detect': {
      const e = input.exposure;
      if (!e) return null;
      return e.openValueZar > 0
        ? `${money(e.openValueZar)} leaking across ${e.findingCount} finding${e.findingCount === 1 ? '' : 's'} — every amount drills to its ERP records.`
        : 'No open exposure in your latest complete run.';
    }
    case 'fix': {
      const f = input.fixes;
      if (!f) return null;
      return f.pendingCount > 0
        ? `${money(f.pendingValueZar)} sits still until someone signs.`
        : 'Queue clear — nothing waiting on a signature.';
    }
    case 'recover': {
      const s = input.savings;
      if (!s) return null;
      return s.recoveredZar > 0
        ? `${money(s.recoveredZar)} booked back${s.roiMultiple > 0 ? ` — ${s.roiMultiple.toFixed(1)}× what Atheon costs` : ''}.`
        : 'Nothing recovered yet — approved fixes drive this number.';
    }
    case 'report': {
      const s = input.savings;
      if (!s) return null;
      return s.recoveredZar > 0
        ? `Built from ${money(s.recoveredZar)} of confirmed recoveries — nothing projected.`
        : 'Reports build from confirmed recoveries — none booked yet.';
    }
  }
}

// ponytail: bespoke painter deleted — the shared mountRiver engine (src/x/river.ts)
// is the one river everywhere; this hook just mounts the value-chain graph on it.
function useRiver(activity: Activity) {
  const riverRef = useRef<HTMLDivElement>(null);
  const graph = useMemo(
    () => valueChainRiver(activity),
    [activity.flow, activity.leak, activity.pool, activity.land], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!riverRef.current) return;
    return mountRiver(riverRef.current, graph.nodes, graph.edges);
  }, [graph]);
  return riverRef;
}

const RAG_COLOR: Record<JourneyStage['rag'], string | null> = {
  green: 'var(--positive)', amber: 'var(--warning)', red: 'var(--neg)', none: null,
};

export function ValueChainFlow({ focus, className }: { focus?: StageKey; className?: string }) {
  const role = useAppStore((s) => s.user?.role);
  const currency = useTenantCurrency();
  const { input, stages } = useJourneyInput();

  const activity: Activity = {
    flow: !!input?.connections && input.connections.total > 0,
    leak: !!input?.exposure && input.exposure.openValueZar > 0,
    pool: !!input?.fixes && input.fixes.pendingCount > 0,
    land: !!input?.savings && input.savings.recoveredZar > 0,
  };
  const focusKey = focus ?? stages.find((s) => s.current)?.key;
  const riverRef = useRiver(activity);

  // Focused column takes ~2× the width so the page's stage is the centrepiece.
  const gridCols = stages.map((s) => (s.key === focusKey ? '1.9fr' : '1fr')).join(' ');

  return (
    <section aria-label="Your recovery value chain" className={cn('mb-6', className)}>
      <div
        className="relative overflow-hidden rounded-[20px] border"
        style={{
          borderColor: 'var(--border-card)',
          background: 'linear-gradient(180deg, var(--bg-card), var(--bg-secondary))',
          minHeight: 'clamp(200px, 25vw, 252px)',
        }}
      >
        {/* .rx scopes the river tokens; canvas-only graph, cards carry the numbers */}
        <div aria-hidden="true" className="rx absolute inset-0" style={{ minHeight: 'auto', background: 'transparent' }}>
          <div ref={riverRef} className="absolute inset-0">
            <canvas style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          </div>
        </div>
        <ol className="relative grid gap-1.5 p-3 sm:p-4" style={{ gridTemplateColumns: gridCols }}>
          {stages.map((s, i) => {
            const on = s.key === focusKey;
            const dot = RAG_COLOR[s.rag];
            const clickable = stageAccessible(s.key, role);
            const context = on ? contextFor(s.key, input, currency) : null;
            const inner = (
              <div
                className={cn(
                  'h-full rounded-xl border transition-colors backdrop-blur-[2px]',
                  on ? 'shadow-sm p-3 sm:p-4' : 'opacity-90 p-2.5',
                )}
                style={{
                  borderColor: on ? 'var(--accent)' : 'var(--border-card)',
                  background: on ? 'var(--accent-subtle)' : 'color-mix(in srgb, var(--bg-card) 78%, transparent)',
                }}
              >
                <p className="flex items-center gap-1.5 text-label">
                  <span aria-hidden="true" className="tnum">{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate">{s.label}</span>
                  {dot && <span aria-hidden="true" className="ml-auto inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />}
                </p>
                <p className={cn('mt-1.5 tnum truncate', on ? 'text-headline-xl' : 'text-headline')} style={{ color: on ? 'var(--accent)' : 'var(--text-primary)' }}>
                  {s.headline ?? '—'}
                </p>
                <p className="text-caption t-muted truncate">{s.sub ?? ' '}</p>
                {context && <p className="mt-2 text-caption t-secondary hidden sm:block">{context}</p>}
                {on && clickable && (
                  <p className="mt-2 text-caption font-medium text-accent hidden sm:inline-flex items-center gap-1 group-hover:underline">
                    {s.cta} <ArrowRight size={11} aria-hidden="true" />
                  </p>
                )}
              </div>
            );
            return (
              <li key={s.key} className="min-w-0">
                {clickable ? (
                  <Link to={s.route} aria-current={on ? 'step' : undefined} className="block h-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-xl">
                    {inner}
                  </Link>
                ) : (
                  <div className="block h-full">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-2 text-caption t-muted max-w-[70ch]">
        Your value chain, left to right. The stream is qualitative — every figure above is a booked ERP number, em-dashed until it exists.
      </p>
    </section>
  );
}

export default ValueChainFlow;
