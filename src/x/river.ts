// The river — canvas flow engine, ported verbatim from the "Atheon — Recovery
// Console" artifact. Bezier edges (width grows with amount — an ordinal cue,
// not a proportional scale: callers sqrt-normalize and widths are affine),
// particles along the curves,
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
  tag?: string; // boundary chip: EXTERNAL / INTERNAL / YOUR CALL
  tone?: RiverTone;
  cls?: string; // extra fnode classes, e.g. 'stage leaky'
  anchor?: string; // section this node deep-links to
  dim?: boolean;
  sealed?: boolean; // figure is a directly booked API field — drawer may show the audit-chain seal
  prov?: string; // node-specific provenance sentence for the drawer
  // drill-down payloads, rendered by the drawer (canvas never draws these):
  rows?: Array<{ label: string; value: string; sub?: string }>; // what's inside this node
  downstream?: Array<{ label: string; value: string; sub?: string }>; // impact on the stages after it
}

export interface RiverEdge {
  from: string;
  to: string;
  amt: number; // normalized 0..1-ish; drives width + speed
  colorVar: string; // one of the --f-* tokens
  particles: number; // 0 = static edge (null/zero field — honesty law)
  pool?: boolean; // bunch at the gate until a decision is signed
  dim?: boolean;
  dashed?: boolean; // null source field — motion-free honesty channel (reduced-motion users see it too)
}

export interface RiverOpts {
  wBase?: number;
  wScale?: number;
  poolT?: number;
  lanes?: { y: number; label: string }[]; // faint bands: outside vs inside the business
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
    TOK.faint = cs.getPropertyValue('--faint').trim() || '#8a90ab';
    TOK.mut = cs.getPropertyValue('--mut').trim() || String(TOK.faint);
    TOK.line = cs.getPropertyValue('--line').trim() || 'rgba(84,98,156,0.14)';
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
    d.className = ['fnode', TONE_CLS[n.tone ?? 'none'], n.cls ?? '', pooled.has(n.id) ? 'gate' : '', n.dim ? 'dim' : '']
      .filter(Boolean).join(' ');
    d.style.left = n.x * 100 + '%';
    d.style.top = n.y * 100 + '%';
    if (n.tag) {
      const ft = document.createElement('div');
      ft.className = 'ftag';
      ft.textContent = n.tag;
      d.appendChild(ft);
    }
    const fk = document.createElement('div');
    fk.className = 'fk';
    fk.textContent = n.kicker;
    d.appendChild(fk);
    const fv = document.createElement('span');
    fv.className = 'fv num';
    fv.textContent = n.value;
    d.appendChild(fv);
    if (opts.onNodeClick) {
      // whole tile is the drill-through target, not just the number
      d.classList.add('link');
      d.setAttribute('role', 'button');
      d.tabIndex = 0;
      d.setAttribute('aria-label', `${n.kicker} ${n.value} — open details`);
      d.addEventListener('click', () => opts.onNodeClick?.(n));
      d.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onNodeClick?.(n); }
      });
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
      ask.addEventListener('click', (ev) => { ev.stopPropagation(); opts.onAskJeff?.(n); });
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

  // Auto-spacing: tiles size to their content, then each row is re-spaced so
  // nothing overlaps or clips. Caller x gives ORDER and rough position; the
  // engine owns the final pixel. Rows of 4+ (the value chain) justify with
  // equal gaps across the full band; sparse rows keep their semantic anchors,
  // clamped inside the panel and pushed apart when they'd collide.
  // Mutates n.x so the canvas edges follow the tiles; ox keeps caller intent
  // stable across resizes.
  const placed = nodes.filter((n) => n.kicker);
  const ox = new Map(placed.map((n) => [n.id, n.x]));
  function autoSpace() {
    if (!W) return;
    const pad = 14, gap = 16;
    const setX = (n: RiverNode, d: HTMLElement, cx: number) => {
      n.x = cx / W;
      d.style.left = n.x * 100 + '%';
    };
    const rows = new Map<number, Array<{ n: RiverNode; d: HTMLElement; w: number }>>();
    placed.forEach((n, i) => {
      const key = Math.round(n.y * 12); // ~8% bands = one visual row
      const arr = rows.get(key) ?? [];
      arr.push({ n, d: tiles[i], w: tiles[i].offsetWidth });
      rows.set(key, arr);
    });
    rows.forEach((row) => {
      row.sort((a, b) => ox.get(a.n.id)! - ox.get(b.n.id)!);
      const usable = W - pad * 2;
      const widths = row.reduce((s, t) => s + t.w, 0);
      if (row.length >= 4) {
        // ponytail: gap floor 4px — at panel min-width a long chain may touch, never stack
        const g = Math.max(4, (usable - widths) / (row.length - 1));
        let x = pad + Math.max(0, (usable - widths - g * (row.length - 1)) / 2);
        row.forEach((t) => { setX(t.n, t.d, x + t.w / 2); x += t.w + g; });
      } else {
        row.forEach((t) => {
          const cx = Math.min(Math.max(ox.get(t.n.id)! * W, pad + t.w / 2), W - pad - t.w / 2);
          setX(t.n, t.d, cx);
        });
        for (let i = 1; i < row.length; i++) {
          const minC = row[i - 1].n.x * W + row[i - 1].w / 2 + gap + row[i].w / 2;
          if (row[i].n.x * W < minC) setX(row[i].n, row[i].d, minC);
        }
        let bound = W - pad;
        for (let i = row.length - 1; i >= 0; i--) {
          const maxC = bound - row[i].w / 2;
          if (row[i].n.x * W > maxC) setX(row[i].n, row[i].d, maxC);
          bound = row[i].n.x * W - row[i].w / 2 - gap;
        }
      }
    });
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
      parts.push({ e, t: Math.random(), sp: 0.028 + Math.random() * 0.02, ph: Math.random() * Math.PI * 2, r: 2.3 * (0.85 + Math.random() * 0.5) });
  });

  let raf = 0, last = 0;
  function frame(ts: number) {
    raf = requestAnimationFrame(frame);
    if (!visible || !el.offsetParent) { last = 0; return; }
    if (!W) { layout(); autoSpace(); }
    if (!W) return;
    const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
    last = ts;
    ctx!.clearRect(0, 0, W, H);
    (opts.lanes ?? []).forEach((l) => {
      const y = l.y * H;
      ctx!.strokeStyle = String(TOK.line);
      ctx!.globalAlpha = 0.7;
      ctx!.setLineDash([2, 6]);
      ctx!.lineWidth = 1;
      ctx!.beginPath(); ctx!.moveTo(12, y); ctx!.lineTo(W - 12, y); ctx!.stroke();
      ctx!.setLineDash([]);
      // label at full alpha in the muted ink — the band name must stay legible
      ctx!.globalAlpha = 1;
      ctx!.fillStyle = String(TOK.mut);
      ctx!.font = '600 10px "Space Mono", monospace';
      // label names the band BELOW its line
      ctx!.fillText(l.label.toUpperCase(), 14, y + 14);
    });
    edges.forEach((e) => {
      ctx!.beginPath();
      for (let i = 0; i <= 36; i++) {
        const [x, y] = P(e, i / 36);
        if (i) ctx!.lineTo(x, y); else ctx!.moveTo(x, y);
      }
      const dimK = e.dim ? 0.25 : 1;
      const col = String(TOK[e.colorVar] ?? '#888');
      const glow = Number(TOK.glow);
      ctx!.strokeStyle = col;
      ctx!.lineCap = 'round';
      const w = eW(e);
      if (e.dashed) ctx!.setLineDash([7, 7]);
      // three-layer stream: wide soft base (glow halo in dark), mid body, bright core
      if (glow > 0) { ctx!.shadowColor = col; ctx!.shadowBlur = glow * 0.9; }
      ctx!.globalAlpha = 0.1 * dimK; ctx!.lineWidth = w * 2.6; ctx!.stroke();
      ctx!.shadowBlur = 0;
      ctx!.globalAlpha = 0.22 * dimK; ctx!.lineWidth = w * 1.4; ctx!.stroke();
      ctx!.globalAlpha = 0.45 * dimK; ctx!.lineWidth = Math.max(1, w * 0.6); ctx!.stroke();
      ctx!.setLineDash([]);
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
      ctx!.globalAlpha = (0.55 + 0.35 * Math.sin(ts * 0.004 + p.ph * 3)) * (p.e.dim ? 0.25 : 1);
      ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.globalAlpha = 1;
    });
  }

  const relayout = () => { layout(); autoSpace(); };
  relayout();
  // web fonts change tile widths — re-space once they land
  document.fonts?.ready.then(() => autoSpace()).catch(() => {});
  const ro = new ResizeObserver(relayout);
  ro.observe(el);
  // stop the loop entirely while scrolled off-screen — restart resets `last`
  // in frame() so the first dt after re-entry stays sane
  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    const now = entry.isIntersecting;
    if (now === visible) return;
    visible = now;
    cancelAnimationFrame(raf);
    if (visible) raf = requestAnimationFrame(frame);
  });
  io.observe(el);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    mo.disconnect();
    mq.removeEventListener?.('change', readTokens);
    tiles.forEach((t) => t.remove());
    ctx.clearRect(0, 0, W, H);
  };
}
