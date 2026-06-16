// src/lib/finding-charts.ts
// Pure SVG chart geometry for per-finding exports. Returns inline SVG strings —
// no chart library, no DOM — so the SAME geometry renders in React (dangerously
// set / inline) and in the worker Value PDF HTML. MIRROR: keep
// workers/api/src/lib/finding-charts.ts byte-identical.

const SAGE = '#A3B18A';
const BRONZE = '#CDA37E';
const NAVY = '#0a0e2a';
const MUTED = '#64748b';
const RAG = { healthy: '#5d8a6f', watch: '#d97706', risk: '#dc2626' };

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-ZA');
}

export interface SampleDelta { ref: string; source_value: string | number; target_value: string | number; difference: number }

/** Confidence ring. gatePassed=false OR conf<0.5 => "Indicative — confirm". */
export function confidenceGauge(confidence: number, gatePassed: boolean): string {
  const pct = Math.max(0, Math.min(1, confidence));
  const indicative = !gatePassed || pct < 0.5;
  const r = 30, c = 2 * Math.PI * r, off = c - pct * c;
  const color = pct >= 0.8 ? RAG.healthy : pct >= 0.5 ? RAG.watch : RAG.risk;
  const caption = indicative ? 'Indicative — confirm' : `${Math.round(pct * 100)}% confidence`;
  return `<svg width="90" height="90" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${caption}">
<circle cx="40" cy="40" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="6"/>
<circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
  stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 40 40)"/>
<text x="40" y="44" text-anchor="middle" font-size="14" font-weight="bold" fill="${NAVY}">${Math.round(pct * 100)}%</text>
<text x="40" y="76" text-anchor="middle" font-size="8" fill="${indicative ? RAG.watch : MUTED}">${caption}</text>
</svg>`;
}

/** Immediate (one-off) vs ongoing annualised (monthly x 12). */
export function immediateVsOngoing(immediate: number, ongoingMonthly: number): string {
  const ongoingAnnual = ongoingMonthly * 12;
  const max = Math.max(1, immediate, ongoingAnnual);
  const w = 220, barMax = 150, h = 70;
  const immW = (immediate / max) * barMax;
  const ongW = (ongoingAnnual / max) * barMax;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<text x="0" y="14" font-size="9" fill="${MUTED}">One-off</text>
<rect x="60" y="6" width="${immW.toFixed(1)}" height="12" rx="2" fill="${BRONZE}"/>
<text x="${(64 + immW).toFixed(1)}" y="16" font-size="9" fill="${NAVY}">R${fmt(immediate)}</text>
<text x="0" y="42" font-size="9" fill="${MUTED}">Recurring/yr</text>
<rect x="60" y="34" width="${ongW.toFixed(1)}" height="12" rx="2" fill="${SAGE}"/>
<text x="${(64 + ongW).toFixed(1)}" y="44" font-size="9" fill="${NAVY}">R${fmt(ongoingAnnual)}</text>
</svg>`;
}

/** Grouped source-vs-target bars from sample deltas. '' when no samples. */
export function sourceVsTarget(samples: SampleDelta[], cap = 6): string {
  if (!samples.length) return '';
  const shown = samples.slice(0, cap);
  const more = samples.length - shown.length;
  const nums = shown.flatMap(s => [Number(s.source_value) || 0, Number(s.target_value) || 0]);
  const max = Math.max(1, ...nums.map(Math.abs));
  const groupW = 34, h = 90, barMax = 56, baseY = 70;
  let x = 10;
  let bars = '';
  for (const s of shown) {
    const sv = Number(s.source_value) || 0, tv = Number(s.target_value) || 0;
    const sh = (Math.abs(sv) / max) * barMax, th = (Math.abs(tv) / max) * barMax;
    bars += `<rect x="${x}" y="${baseY - sh}" width="12" height="${sh.toFixed(1)}" fill="${NAVY}"/>`;
    bars += `<rect x="${x + 14}" y="${baseY - th}" width="12" height="${th.toFixed(1)}" fill="${BRONZE}"/>`;
    bars += `<text x="${x + 13}" y="${baseY + 10}" text-anchor="middle" font-size="7" fill="${MUTED}">${s.ref.slice(0, 6)}</text>`;
    x += groupW;
  }
  const width = x + 10;
  const note = more > 0 ? `<text x="${width - 6}" y="86" text-anchor="end" font-size="8" fill="${MUTED}">+ ${more} more</text>` : '';
  return `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" xmlns="http://www.w3.org/2000/svg">
<text x="10" y="12" font-size="8" fill="${NAVY}">■ source</text><text x="64" y="12" font-size="8" fill="${BRONZE}">■ target</text>
${bars}${note}</svg>`;
}

export interface DomainValue { domain: string; immediate: number; ongoing: number }

/** Value-by-domain horizontal waterfall (annualised total per domain). */
export function domainWaterfall(domains: DomainValue[]): string {
  if (!domains.length) return '';
  const rows = domains.map(d => ({ ...d, total: d.immediate + d.ongoing * 12 })).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map(r => r.total));
  const barMax = 200, rowH = 18, w = 320;
  let y = 14, body = '';
  for (const r of rows) {
    const bw = (r.total / max) * barMax;
    const immW = (r.immediate / Math.max(1, r.total)) * bw;
    body += `<text x="0" y="${y + 9}" font-size="8" fill="${MUTED}">${r.domain.slice(0, 14)}</text>`;
    body += `<rect x="80" y="${y}" width="${bw.toFixed(1)}" height="11" rx="1.5" fill="${SAGE}"/>`;
    body += `<rect x="80" y="${y}" width="${Math.max(0.5, immW).toFixed(1)}" height="11" rx="1.5" fill="${BRONZE}"/>`;
    body += `<text x="${(84 + bw).toFixed(1)}" y="${y + 9}" font-size="8" fill="${NAVY}">R${fmt(r.total)}</text>`;
    y += rowH;
  }
  return `<svg width="${w}" height="${y + 4}" viewBox="0 0 ${w} ${y + 4}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export interface SeverityCounts { critical: number; high: number; medium: number; low: number }

/** Severity distribution stacked bar. */
export function severityDistribution(counts: SeverityCounts): string {
  const order: Array<[keyof SeverityCounts, string]> = [['critical', '#dc2626'], ['high', '#ea580c'], ['medium', '#d97706'], ['low', '#65a30d']];
  const total = order.reduce((s, [k]) => s + (counts[k] || 0), 0) || 1;
  const w = 300, barW = 280;
  let x = 10, body = '';
  for (const [k, color] of order) {
    const seg = ((counts[k] || 0) / total) * barW;
    if (seg <= 0) continue;
    body += `<rect x="${x.toFixed(1)}" y="8" width="${seg.toFixed(1)}" height="14" fill="${color}"/>`;
    if (seg > 22) body += `<text x="${(x + seg / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="8" fill="#fff">${counts[k]}</text>`;
    x += seg;
  }
  return `<svg width="${w}" height="30" viewBox="0 0 ${w} 30" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
