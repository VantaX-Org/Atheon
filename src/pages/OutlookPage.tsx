/**
 * Outlook — the C-suite read on EXTERNAL forces and their modelled impact,
 * with an interactive what-if simulation. Graphical, hero-grade.
 *
 * Honesty (hard law): nothing here is a confirmed Rand. Signals are real,
 * sourced external items (api.radar.getContext). Their impact is MODELLED onto
 * health dimensions (points, direction, magnitude) — never money, never
 * counted in the Brief's confirmed total. The simulation is explicitly
 * ILLUSTRATIVE: it scales the backend's own modelled magnitudes linearly to
 * show sensitivity — it is not a forecast. Everything sits behind a "modelled ·
 * not counted" fence. Empty / failed loads degrade honestly (no fake zero).
 *
 * Consolidation (design principle): folds Apex's separate "Strategic Context"
 * (signals) and part of "What-If" into ONE flowing graphical surface; the full
 * scenario engine still lives in Apex and is linked, not rebuilt.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ExternalLink, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { RadarSignalItem, RadarSignalImpactItem } from '@/lib/api';

// ── Pure helpers (unit-tested in OutlookPage.test.ts) ────────────────────────

const SEVERITY_WEIGHT: Record<string, number> = { critical: 1, high: 0.7, medium: 0.4, low: 0.2 };

/** Signed modelled points for one impact: + tailwind, − headwind, 0 neutral. */
export function signedMagnitude(i: Pick<RadarSignalImpactItem, 'impactDirection' | 'impactMagnitude'>): number {
  const m = Number.isFinite(i.impactMagnitude) ? i.impactMagnitude : 0;
  if (i.impactDirection === 'positive') return m;
  if (i.impactDirection === 'negative') return -m || 0; // avoid -0
  return 0;
}

/** Aggregate impacts into one signed net per health dimension, biggest-abs first. */
export function byDimension(impacts: RadarSignalImpactItem[]): { dimension: string; net: number }[] {
  const acc = new Map<string, number>();
  for (const i of impacts) acc.set(i.dimension, (acc.get(i.dimension) ?? 0) + signedMagnitude(i));
  return [...acc.entries()]
    .map(([dimension, net]) => ({ dimension, net }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

/** What-if: scale ONLY headwinds (negative dims) by `intensity`; tailwinds unchanged. */
export function simulate(dims: { dimension: string; net: number }[], intensity: number): { dimension: string; net: number }[] {
  return dims.map((d) => ({ dimension: d.dimension, net: d.net < 0 ? d.net * intensity : d.net }));
}

export const netOf = (dims: { net: number }[]): number => dims.reduce((s, d) => s + d.net, 0);

// ── Diverging horizon (the hero graphic) ─────────────────────────────────────

function ImpactHorizon({ dims }: { dims: { dimension: string; net: number }[] }) {
  const max = Math.max(1, ...dims.map((d) => Math.abs(d.net)));
  const W = 640, rowH = 34, mid = W / 2, barMax = mid - 120;
  const H = dims.length * rowH + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img" aria-label="Modelled impact by health dimension">
      <line x1={mid} y1={0} x2={mid} y2={H} stroke="var(--border-card)" strokeWidth={1} />
      {dims.map((d, idx) => {
        const y = idx * rowH + 4;
        const w = (Math.abs(d.net) / max) * barMax;
        const tail = d.net >= 0;
        const color = d.net === 0 ? 'var(--text-muted)' : tail ? 'var(--positive)' : 'var(--neg)';
        return (
          <g key={d.dimension}>
            <rect x={tail ? mid : mid - w} y={y} width={w} height={rowH - 12} rx={3} fill={color} fillOpacity={0.85} />
            <text x={tail ? mid + w + 8 : mid - w - 8} y={y + (rowH - 12) / 2 + 4}
              textAnchor={tail ? 'start' : 'end'} fontSize={12} fill="var(--text-secondary)">
              {d.dimension}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function OutlookPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [signals, setSignals] = useState<RadarSignalItem[]>([]);
  const [impacts, setImpacts] = useState<RadarSignalImpactItem[]>([]);
  const [detectedAt, setDetectedAt] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(1);

  useEffect(() => {
    api.radar.getContext()
      .then((r) => {
        setSignals(r.signals ?? []);
        setImpacts(r.impacts ?? []);
        const sorted = (r.signals ?? []).map((s) => s.detectedAt).filter(Boolean).sort();
        setDetectedAt(sorted.length ? sorted[sorted.length - 1] : null);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const dims = useMemo(() => byDimension(impacts), [impacts]);
  const simDims = useMemo(() => simulate(dims, intensity), [dims, intensity]);
  const baseNet = useMemo(() => netOf(dims), [dims]);
  const simNet = useMemo(() => netOf(simDims), [simDims]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>;
  }

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const topSignals = [...signals]
    .sort((a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) * b.relevanceScore - (SEVERITY_WEIGHT[a.severity] ?? 0) * a.relevanceScore)
    .slice(0, 6);

  return (
    <div className="mx-auto w-full max-w-3xl flex flex-col gap-8 py-2">
      <header className="flex flex-col gap-1 pb-4" style={{ borderBottom: '1px solid var(--border-card)' }}>
        <p className="text-sm font-semibold t-primary">The Outlook</p>
        <p className="text-sm t-secondary">External forces on the business · {dateLabel}</p>
        <p className="text-xs t-muted">
          {failed ? "External signal feed couldn't be loaded."
            : signals.length === 0 ? 'No external signals scanned yet.'
            : `${signals.length} external signal${signals.length === 1 ? '' : 's'} scanned${detectedAt ? `, latest ${new Date(detectedAt).toLocaleDateString()}` : ''}.`}
        </p>
      </header>

      {failed && (
        <p className="text-[15px] leading-relaxed t-primary">
          The external outlook is unavailable right now.{' '}
          <button onClick={() => { setFailed(false); setLoading(true); api.radar.getContext().then((r) => { setSignals(r.signals ?? []); setImpacts(r.impacts ?? []); }).catch(() => setFailed(true)).finally(() => setLoading(false)); }} className="text-accent font-medium hover:underline">Retry</button>
        </p>
      )}

      {!failed && dims.length === 0 && (
        <p className="text-[15px] leading-relaxed t-primary">
          No external signal has a modelled impact on your health yet. When the radar scans one, its effect appears here — modelled, never counted in your confirmed numbers.
        </p>
      )}

      {dims.length > 0 && (
        <>
          {/* Hero graphic: modelled impact horizon */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.12em] t-muted font-medium">Modelled impact by health dimension</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: baseNet >= 0 ? 'var(--positive)' : 'var(--neg)' }}>
                {baseNet >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                net {baseNet >= 0 ? '+' : ''}{baseNet.toFixed(1)} pts
              </span>
            </div>
            <ImpactHorizon dims={intensity === 1 ? dims : simDims} />
            <div className="flex items-center gap-4 text-xs t-muted">
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'var(--positive)' }} /> Tailwind</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'var(--neg)' }} /> Headwind</span>
            </div>
          </section>

          {/* Simulation */}
          <section className="flex flex-col gap-3 rounded-lg p-4" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-semibold t-primary">What if the headwinds intensify?</p>
              <span className="text-sm font-mono tnum t-secondary">×{intensity.toFixed(1)}</span>
            </div>
            <input
              type="range" min={0.5} max={2} step={0.1} value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
              aria-label="Headwind intensity multiplier"
            />
            <p className="text-sm t-secondary leading-relaxed">
              At ×{intensity.toFixed(1)} the modelled net moves from{' '}
              <span className="font-semibold" style={{ color: baseNet >= 0 ? 'var(--positive)' : 'var(--neg)' }}>{baseNet >= 0 ? '+' : ''}{baseNet.toFixed(1)}</span>
              {' '}to{' '}
              <span className="font-semibold" style={{ color: simNet >= 0 ? 'var(--positive)' : 'var(--neg)' }}>{simNet >= 0 ? '+' : ''}{simNet.toFixed(1)}</span>
              {' '}points of health.
            </p>
            <p className="text-xs t-muted leading-relaxed">
              Illustrative simulation — scales the modelled headwind magnitudes linearly to show sensitivity. Not a forecast, and not counted in your confirmed numbers.
            </p>
          </section>

          {/* Real sourced signals */}
          <section className="flex flex-col gap-3">
            <p className="text-[11px] uppercase tracking-[0.12em] t-muted font-semibold">The signals behind it</p>
            {topSignals.map((s) => (
              <article key={s.id} className="flex flex-col gap-1 rounded-lg p-3.5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-medium t-primary leading-snug">{s.title}</p>
                  <span className="text-[10px] uppercase tracking-wide t-muted flex-shrink-0 mt-0.5">{s.signalType}</span>
                </div>
                {s.description && <p className="text-sm t-secondary leading-relaxed line-clamp-2">{s.description}</p>}
                <div className="flex items-center gap-3 text-xs t-muted pt-0.5">
                  <span>{s.source}</span>
                  <span>·</span>
                  <span className="capitalize">{s.severity}</span>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline ml-auto">
                      Source <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      <footer className="pt-4 mt-2 text-xs t-muted flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border-card)' }}>
        <span>External context — modelled, never counted in your confirmed numbers.</span>
        <button onClick={() => navigate('/apex')} className="text-accent hover:underline">Run a full what-if in Apex →</button>
      </footer>
    </div>
  );
}

export default OutlookPage;
