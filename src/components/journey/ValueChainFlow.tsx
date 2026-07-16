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
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAppStore, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { stageAccessible, type JourneyStage, type StageInput, type StageKey } from '@/lib/journey';
import { useJourneyInput } from '@/lib/use-journey-input';
import { cn } from '@/lib/utils';

const STAGE_INDEX: Record<StageKey, number> = { connect: 0, detect: 1, fix: 2, recover: 3, report: 4 };

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  return {
    accent: v('--accent', '#2453ff'),
    positive: v('--positive', '#0f8a4d'),
    warning: v('--warning', '#9a6200'),
    faint: v('--text-muted', '#6a6f7e'),
  };
}

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

// Draw the river for one frame. t is seconds. Particle phase p in [0,1) is stored
// per-particle and advanced by the caller; here we only paint.
function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  parts: { p: number; lane: number; sp: number; sz: number }[],
  c: ReturnType<typeof readColors>,
  a: Activity,
  focusIdx: number, // -1 = no focused stage
) {
  ctx.clearRect(0, 0, w, h);
  const midY = h * 0.7;
  const band = h * 0.3;
  const fx = (i: number) => ((i + 0.5) / 5) * w; // stage centre x
  const detectF = fx(STAGE_INDEX.detect);
  const fixF = fx(STAGE_INDEX.fix);
  const recoverF = fx(STAGE_INDEX.recover);

  // Soft accent glow under the focused column — ties the river to the page.
  if (focusIdx >= 0) {
    const cx = fx(focusIdx);
    const half = w * 0.14;
    const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    g.addColorStop(0, 'transparent');
    g.addColorStop(0.5, c.accent);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = g;
    ctx.fillRect(cx - half, 0, half * 2, h);
  }

  // Base ribbon — accent flowing in, green landing past the recover column.
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, c.accent);
  grad.addColorStop(Math.min(0.99, recoverF / w), c.accent);
  grad.addColorStop(1, a.land ? c.positive : c.accent);
  ctx.globalAlpha = a.flow ? 0.1 : 0.05;
  ctx.fillStyle = grad;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 8) {
    const y = midY + Math.sin(x * 0.012 + t * 0.9) * band * 0.18;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Pool under the fix column — money waiting on a signature.
  if (a.pool) {
    const r = band * (0.7 + Math.sin(t * 1.6) * 0.12);
    const g = ctx.createRadialGradient(fixF, midY, 0, fixF, midY, r * 2.4);
    g.addColorStop(0, c.accent);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(fixF, midY, r * 2.2, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flowing particles.
  ctx.globalAlpha = a.flow ? 0.85 : 0.25;
  for (const pt of parts) {
    const x = pt.p * w;
    const y = midY + pt.lane * band * 0.42 + Math.sin(t * pt.sp * 6 + pt.p * 12) * 3;
    ctx.fillStyle = a.land && x >= recoverF ? c.positive : c.accent;
    // short capsule dash; fillRect avoids roundRect (untyped under ES2020 DOM lib)
    ctx.fillRect(x, y, pt.sz * 3.2, pt.sz);
  }

  // Leak spurts peeling off the detect column — open exposure not yet caught.
  if (a.leak) {
    ctx.fillStyle = c.warning;
    for (let i = 0; i < 6; i++) {
      const prog = ((t * 0.5 + i / 6) % 1);
      const x = detectF + prog * w * 0.015 + Math.sin(i) * 4;
      const y = midY + prog * band * 1.5;
      ctx.globalAlpha = (1 - prog) * 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function useRiver(activity: Activity, focusIdx: number) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actRef = useRef(activity);
  actRef.current = activity;
  const focusRef = useRef(focusIdx);
  focusRef.current = focusIdx;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let colors = readColors();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    const parts = Array.from({ length: 46 }, (_, i) => ({
      p: (i / 46),
      lane: ((i * 37) % 100) / 50 - 1, // deterministic spread, no Math.random
      sp: 0.04 + ((i * 13) % 7) / 120,
      sz: 1.4 + ((i * 7) % 4) * 0.5,
    }));

    const resize = () => {
      w = wrap.clientWidth; h = wrap.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Re-read palette when the viewer flips theme.
    const onTheme = () => { colors = readColors(); };
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);

    let raf = 0, last = 0, tSec = 0;
    const frame = (ts: number) => {
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
      last = ts; tSec += dt;
      const a = actRef.current;
      if (a.flow) for (const pt of parts) { pt.p += pt.sp * dt; if (pt.p >= 1) pt.p -= 1; }
      paint(ctx, w, h, tSec, parts, colors, a, focusRef.current);
      raf = requestAnimationFrame(frame);
    };
    if (reduce) {
      paint(ctx, w, h, 0, parts, colors, actRef.current, focusRef.current); // one static frame
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener('change', onTheme);
    };
  }, []);

  return { wrapRef, canvasRef };
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
  const { wrapRef, canvasRef } = useRiver(activity, focusKey ? STAGE_INDEX[focusKey] : -1);

  // Focused column takes ~2× the width so the page's stage is the centrepiece.
  const gridCols = stages.map((s) => (s.key === focusKey ? '1.9fr' : '1fr')).join(' ');

  return (
    <section aria-label="Your recovery value chain" className={cn('mb-6', className)}>
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-[20px] border"
        style={{
          borderColor: 'var(--border-card)',
          background: 'linear-gradient(180deg, var(--bg-card), var(--bg-secondary))',
          minHeight: 'clamp(200px, 25vw, 252px)',
        }}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
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
