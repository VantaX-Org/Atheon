// The river — canvas flow engine, ported verbatim from the "Atheon — Recovery
// Console" artifact. Bezier edges (width ∝ amount), particles along the curves,
// pool edges bunch at the gate, --glow drives shadowBlur in dark. Particle
// jitter uses Math.random — presentational only, never a data path.

export type RiverTone = 'ok' | 'bad' | 'warn' | 'gold' | 'none';

export interface RiverNode {
  id: string;
  x: number; // 0..1 fraction of panel width
  y: number; // 0..1 fraction of panel height
  kicker: string;
  value: string; // pre-formatted; '—' when the source has not reported
  sub?: string;
  tone?: RiverTone;
  anchor?: string; // section this node deep-links to
  dim?: boolean;
}

export interface RiverEdge {
  from: string;
  to: string;
  amt: number; // normalized 0..1-ish; drives width + speed
  colorVar: string; // one of the --f-* tokens
  particles: number; // 0 = static edge (null/zero field — honesty law)
  pool?: boolean; // bunch at the gate until a decision is signed
  dim?: boolean;
}

export interface RiverOpts {
  wBase?: number;
  wScale?: number;
  poolT?: number;
  onNodeClick?: (n: RiverNode) => void;
  onAskJeff?: (n: RiverNode) => void;
}

const FLOW_VARS = ['--f-rec', '--f-fee', '--f-gate', '--f-revw', '--f-rev', '--f-leak'] as const;
const TONE_CLS: Record<RiverTone, string> = { gold: 'gold', bad: 'bad', warn: '', ok: '', none: '' };

export function mountRiver(el: HTMLElement, nodes: RiverNode[], edges: RiverEdge[], opts: RiverOpts = {}): () => void {
  const canvas = el.querySelector('canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return () => {};

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const byId: Record<string, RiverNode> = {};
  nodes.forEach((n) => (byId[n.id] = n));

  // tokens live on .rx (scoped), so read them off the mount element
  let TOK: Record<string, string | number> = {};
  function readTokens() {
    const cs = getComputedStyle(el);
    TOK = { glow: parseFloat(cs.getPropertyValue('--glow')) || 0 };
    FLOW_VARS.forEach((k) => (TOK[k] = cs.getPropertyValue(k).trim()));
  }
  readTokens();
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', readTokens);
  const mo = new MutationObserver(readTokens);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // node tiles — built with textContent (values/kickers may carry API strings)
  const tiles: HTMLElement[] = [];
  const pooled = new Set(edges.filter((e) => e.pool).map((e) => e.to));
  nodes.forEach((n) => {
    if (!n.kicker) return;
    const d = document.createElement('div');
    d.className = ['fnode', TONE_CLS[n.tone ?? 'none'], pooled.has(n.id) ? 'gate' : '', n.dim ? 'dim' : '']
      .filter(Boolean).join(' ');
    d.style.left = n.x * 100 + '%';
    d.style.top = n.y * 100 + '%';
    const fk = document.createElement('div');
    fk.className = 'fk';
    fk.textContent = n.kicker;
    d.appendChild(fk);
    if (opts.onNodeClick) {
      const fv = document.createElement('button');
      fv.className = 'fv num';
      fv.textContent = n.value;
      fv.addEventListener('click', () => opts.onNodeClick?.(n));
      d.appendChild(fv);
    } else {
      const fv = document.createElement('span');
      fv.className = 'fv num';
      fv.textContent = n.value;
      d.appendChild(fv);
    }
    if (n.sub) {
      const fs = document.createElement('div');
      fs.className = 'fs';
      fs.textContent = n.sub;
      d.appendChild(fs);
    }
    if (opts.onAskJeff) {
      const ask = document.createElement('button');
      ask.className = 'fask';
      ask.textContent = '✦';
      ask.title = 'Ask Jeff about this';
      ask.setAttribute('aria-label', `Ask Jeff about ${n.kicker}`);
      ask.addEventListener('click', () => opts.onAskJeff?.(n));
      d.appendChild(ask);
    }
    el.appendChild(d);
    tiles.push(d);
  });

  let W = 0, H = 0;
  function layout() {
    const r = el.getBoundingClientRect();
    if (!r.width) { W = 0; return; }
    W = r.width; H = r.height;
    const DPR = Math.min(devicePixelRatio || 1, 2);
    canvas!.width = W * DPR;
    canvas!.height = H * DPR;
    ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function P(e: RiverEdge, t: number): [number, number] {
    const a = byId[e.from], b = byId[e.to];
    const x1 = a.x * W, y1 = a.y * H, x2 = b.x * W, y2 = b.y * H;
    const mx = (x1 + x2) / 2, u = 1 - t;
    return [
      u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2,
      u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
    ];
  }

  const GATE_T = opts.poolT ?? 0.88;
  const wScale = opts.wScale || 6.2;
  const eW = (e: RiverEdge) => (opts.wBase || 3) + e.amt * wScale;

  interface Particle { e: RiverEdge; t: number; sp: number; ph: number; r: number }
  const parts: Particle[] = [];
  edges.forEach((e) => {
    for (let i = 0; i < e.particles; i++)
      parts.push({ e, t: Math.random(), sp: 0.028 + Math.random() * 0.02, ph: Math.random() * Math.PI * 2, r: (1.5) * (0.9 + Math.random() * 0.6) });
  });

  let raf = 0, last = 0;
  function frame(ts: number) {
    raf = requestAnimationFrame(frame);
    if (!el.offsetParent) { last = 0; return; }
    if (!W) layout();
    if (!W) return;
    const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
    last = ts;
    ctx!.clearRect(0, 0, W, H);
    edges.forEach((e) => {
      ctx!.beginPath();
      for (let i = 0; i <= 36; i++) {
        const [x, y] = P(e, i / 36);
        if (i) ctx!.lineTo(x, y); else ctx!.moveTo(x, y);
      }
      const dimK = e.dim ? 0.25 : 1;
      ctx!.strokeStyle = String(TOK[e.colorVar] ?? '#888');
      ctx!.lineCap = 'round';
      ctx!.globalAlpha = 0.15 * dimK; ctx!.lineWidth = eW(e); ctx!.stroke();
      ctx!.globalAlpha = 0.10 * dimK; ctx!.lineWidth = Math.max(1, eW(e) * 0.3); ctx!.stroke();
      ctx!.globalAlpha = 1;
    });
    if (reduced) return;
    parts.forEach((p) => {
      let jx = 0, jy = 0;
      if (p.e.pool) {
        p.t = Math.min(p.t + p.sp * dt * 0.5, GATE_T - 0.001);
        jx = Math.sin(ts * 0.001 + p.ph) * 5;
        jy = Math.cos(ts * 0.0013 + p.ph) * 5;
        if (p.t > GATE_T - 0.14) p.t = GATE_T - 0.14 + ((p.ph % 1) * 0.13);
      } else {
        p.t += p.sp * dt;
        if (p.t > 1) p.t = 0;
      }
      const [x, y] = P(p.e, p.t);
      const off = Math.sin(p.ph * 7 + p.t * 9) * (eW(p.e) * 0.28);
      ctx!.beginPath();
      ctx!.arc(x + jx, y + off + jy, p.r, 0, 7);
      ctx!.fillStyle = String(TOK[p.e.colorVar] ?? '#888');
      ctx!.shadowColor = String(TOK[p.e.colorVar] ?? '#888');
      ctx!.shadowBlur = Number(TOK.glow);
      ctx!.globalAlpha = 0.85 * (p.e.dim ? 0.25 : 1);
      ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.globalAlpha = 1;
    });
  }

  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(el);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    mo.disconnect();
    mq.removeEventListener?.('change', readTokens);
    tiles.forEach((t) => t.remove());
    ctx.clearRect(0, 0, W, H);
  };
}
