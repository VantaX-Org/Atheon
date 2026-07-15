/**
 * Persona Insight Dashboards — backend engine (spec: docs/specs/2026-07-14-persona-insight-dashboards.md §4–§5).
 *
 * Pure function over data that already exists — no new detector logic, no new
 * numbers. Filters the latest COMPLETE assessment's findings to a persona's
 * signal set, ranks them, and attaches external context + catalyst CTAs.
 *
 * HONESTY LAW (§5.3):
 *  1. `value_zar` = gate-passed confirmed value only. Gate-failed findings
 *     surface as `potential_unverified` with `value_zar: null`.
 *  2. External signals are `value_kind:'context'`, `value_zar:null`, always —
 *     never summed into any ZAR figure.
 *  3. Every insight CTA deep-links to the finding (which traces to erp_record_id).
 *  4. Insufficient data ≠ zero — no findings means an empty list, not a green zero.
 */
import type { Finding, FindingCode, Severity } from './assessment-findings';
import { summariseFindings } from './assessment-findings';

export type Persona = 'ceo' | 'cfo' | 'coo' | 'cpo' | 'cmo' | 'chro' | 'cio';

export const PERSONAS: Persona[] = ['ceo', 'cfo', 'coo', 'cpo', 'cmo', 'chro', 'cio'];

/**
 * §4 signal matrix — which finding codes belong to which persona lens.
 * Same static-map pattern as FINDING_INFERENCE_KIND. CEO is a rollup (custom
 * 5-card assembly, not a filter set); CIO is platform posture (operational
 * tables, not findings) — both intentionally empty here.
 * The persona-insights lock test asserts every code below exists AND that the
 * union of the five functional personas covers all 40 finding codes.
 */
export const PERSONA_SIGNAL_MAP: Record<Persona, FindingCode[]> = {
  ceo: [],
  cfo: [
    'ar_aging_overdue_30_60', 'ar_aging_overdue_60_90', 'ar_aging_overdue_90_plus',
    'ar_credit_limit_breach', 'ar_top_debtor_concentration',
    'ap_three_way_mismatch', 'ap_unreconciled_bank',
    'gl_suspense_balance', 'gl_journal_off_hours', 'gl_round_amount_journals', 'gl_high_manual_volume',
    'tax_overdue_submission', 'tax_missing_vat_numbers', 'tax_vat_rate_anomaly',
    'fx_currency_exposure', 'fx_dual_use_currency',
    'svc_revenue_recognition_lag',
  ],
  cpo: [
    'proc_maverick_spend', 'proc_duplicate_suppliers', 'proc_supplier_concentration', 'proc_inactive_with_open_pos',
    'ap_three_way_mismatch', 'ap_overdue_delivery',
    'inv_stale_stock', 'inv_dead_stock', 'inv_negative_stock', 'inv_below_reorder',
    'inv_margin_erosion', 'inv_inactive_with_value',
    'tax_missing_vat_numbers',
    'sales_customer_concentration',
  ],
  cmo: [
    'sales_customer_concentration', 'sales_inactive_with_ar', 'sales_credit_no_check',
    'inv_margin_erosion', 'ar_top_debtor_concentration',
  ],
  coo: [
    'svc_low_billable_utilisation', 'svc_unbilled_time_aging', 'svc_project_overrun',
    'svc_project_margin_negative', 'svc_unapproved_time_entries',
    'svc_zero_hours_active_project', 'svc_inactive_employee_billed_time',
    'inv_below_reorder', 'inv_negative_stock', 'inv_stale_stock',
    'ap_overdue_delivery',
  ],
  chro: [
    'hr_terminated_in_payroll', 'hr_high_payroll_concentration',
    'svc_unapproved_time_entries', 'svc_inactive_employee_billed_time',
  ],
  cio: [],
};

/**
 * §5.1 step 4 — which external signal is relevant context for which findings.
 * Keys are pulse channels (fx / brent), values the finding codes whose cards
 * get the external_context strip. Context only — never arithmetic.
 */
export const EXTERNAL_RELEVANCE_MAP: Record<'fx' | 'brent', FindingCode[]> = {
  fx: ['fx_currency_exposure', 'fx_dual_use_currency'],
  brent: [
    'inv_stale_stock', 'inv_dead_stock', 'inv_negative_stock', 'inv_below_reorder',
    'inv_margin_erosion', 'inv_inactive_with_value',
    'ap_overdue_delivery',
    'proc_maverick_spend', 'proc_duplicate_suppliers', 'proc_supplier_concentration', 'proc_inactive_with_open_pos',
  ],
};

export interface PersonaInsight {
  id: string;                     // deterministic: `${persona}:${finding_code}:${assessment_id}`
  persona: Persona;
  severity: 'critical' | 'high' | 'medium' | 'low';
  headline: string;
  detail: string;
  value_zar: number | null;
  value_kind: 'confirmed' | 'potential_unverified' | 'context';
  source: { finding_code?: string; external_signal_id?: string; assessment_id: string };
  external_context?: { signal: string; value: string; direction: 'up' | 'down' | 'flat'; note: string };
  recommended_catalyst?: { cluster: string; sub_catalyst: string };
  cta: { label: string; route: string };
}

interface PulseChannel {
  signal_id: string;
  signal_key: string;
  value: number;
  unit: string;
  direction: 'up' | 'down' | 'flat';
  change_pct: number | null;
  as_of: string;
}

export interface ExternalPulse {
  fx: PulseChannel | null;
  brent: PulseChannel | null;
  /** Macro indicators — SA CPI inflation and GDP growth (World Bank feed). */
  cpi: PulseChannel | null;
  gdp: PulseChannel | null;
  /** Latest real headline from the GDELT news feed — linked, never paraphrased into claims. */
  news_latest: { signal_id: string; title: string; url: string; date: string; domain: string } | null;
  regulatory_latest: { id: string; title: string; jurisdiction: string | null; effective_date: string | null } | null;
}

export interface PersonaInsightsResponse {
  persona: Persona;
  generated_from_assessment_id: string | null;
  insights: PersonaInsight[];
  external_pulse: ExternalPulse | null;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function fmtZar(n: number): string {
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `R${(n / 1_000).toFixed(0)}k`;
  return `R${Math.round(n).toLocaleString()}`;
}

/**
 * Map one gated Finding to a PersonaInsight. Exported for the honesty test:
 * a gate-failed finding MUST come out as potential_unverified with value_zar null.
 */
export function insightFromFinding(persona: Persona, f: Finding, assessmentId: string): PersonaInsight {
  const gatePassed = f.confidence_gate_passed !== false;
  return {
    id: `${persona}:${f.code}:${assessmentId}${f.company_id ? `:${f.company_id}` : ''}`,
    persona,
    severity: f.severity,
    headline: f.title,
    detail: f.narrative,
    value_zar: gatePassed ? f.value_at_risk_zar : null,
    value_kind: gatePassed ? 'confirmed' : 'potential_unverified',
    source: { finding_code: f.code, assessment_id: assessmentId },
    recommended_catalyst: {
      cluster: f.recommended_catalyst.catalyst,
      sub_catalyst: f.recommended_catalyst.sub_catalyst,
    },
    cta: { label: 'View finding', route: `/findings?code=${f.code}` },
  };
}

function attachExternalContext(insight: PersonaInsight, pulse: ExternalPulse | null): PersonaInsight {
  if (!pulse) return insight;
  const code = insight.source.finding_code as FindingCode | undefined;
  if (!code) return insight;
  const channel: PulseChannel | null =
    EXTERNAL_RELEVANCE_MAP.fx.includes(code) ? pulse.fx :
    EXTERNAL_RELEVANCE_MAP.brent.includes(code) ? pulse.brent : null;
  if (!channel) return insight;
  return {
    ...insight,
    source: { ...insight.source, external_signal_id: channel.signal_id },
    external_context: {
      signal: channel.signal_key,
      value: `${channel.value} ${channel.unit}`.trim(),
      direction: channel.direction,
      note: `As of ${channel.as_of}. Context only — not included in any Rand figure.`,
    },
  };
}

/** Latest stored reading for one signal key — same lookup shape as external-signals-feed.ts. */
async function readPulseChannel(db: D1Database, tenantId: string, signalKey: string): Promise<PulseChannel | null> {
  try {
    const row = await db.prepare(
      `SELECT id, raw_data, detected_at FROM external_signals
        WHERE tenant_id = ? AND raw_data LIKE ?
        ORDER BY detected_at DESC LIMIT 1`,
    ).bind(tenantId, `%"signal_key":"${signalKey}"%`).first<{ id: string; raw_data: string; detected_at: string }>();
    if (!row) return null;
    const raw = JSON.parse(row.raw_data) as {
      signal_key: string; latest_value: number; latest_date: string; unit: string;
      history?: Array<{ date: string; value: number }>;
    };
    const prev = raw.history && raw.history.length > 0 ? raw.history[raw.history.length - 1].value : null;
    const changePct = prev ? Math.round(((raw.latest_value - prev) / prev) * 10000) / 100 : null;
    return {
      signal_id: row.id,
      signal_key: raw.signal_key,
      value: raw.latest_value,
      unit: raw.unit || '',
      direction: changePct === null || Math.abs(changePct) < 0.05 ? 'flat' : changePct > 0 ? 'up' : 'down',
      change_pct: changePct,
      as_of: raw.latest_date || row.detected_at,
    };
  } catch {
    return null; // missing table / bad JSON → channel absent, insights still render
  }
}

/** Latest real news headline stored by the GDELT feed source. */
async function readNewsLatest(db: D1Database, tenantId: string): Promise<ExternalPulse['news_latest']> {
  try {
    const row = await db.prepare(
      `SELECT id, raw_data FROM external_signals
        WHERE tenant_id = ? AND raw_data LIKE '%"signal_key":"news.za_economy"%'
        ORDER BY detected_at DESC LIMIT 1`,
    ).bind(tenantId).first<{ id: string; raw_data: string }>();
    if (!row) return null;
    const raw = JSON.parse(row.raw_data) as { articles?: Array<{ title: string; url: string; date: string; domain: string }> };
    const a = raw.articles?.[0];
    return a ? { signal_id: row.id, ...a } : null;
  } catch {
    return null;
  }
}

async function readExternalPulse(db: D1Database, tenantId: string): Promise<ExternalPulse | null> {
  const [fx, brent, cpi, gdp, news] = await Promise.all([
    readPulseChannel(db, tenantId, 'fx.usd_zar'),
    readPulseChannel(db, tenantId, 'oil.brent_spot'),
    readPulseChannel(db, tenantId, 'macro.za_cpi_inflation'),
    readPulseChannel(db, tenantId, 'macro.za_gdp_growth'),
    readNewsLatest(db, tenantId),
  ]);
  let regulatory: ExternalPulse['regulatory_latest'] = null;
  try {
    const row = await db.prepare(
      `SELECT id, title, jurisdiction, effective_date FROM regulatory_events
        WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(tenantId).first<{ id: string; title: string; jurisdiction: string | null; effective_date: string | null }>();
    if (row) regulatory = row;
  } catch { /* table absent → no regulatory pulse */ }
  if (!fx && !brent && !cpi && !gdp && !news && !regulatory) return null;
  return { fx, brent, cpi, gdp, news_latest: news, regulatory_latest: regulatory };
}

// ── Economic exposure (supply / demand / value-chain net) ───────────────────
// Booked figures straight from erp rows — native currency only, never converted
// to ZAR here. Shown beside the FX pulse so the reader draws the conclusion
// (honesty law §5.3.2).

export interface EconomicExposureLeg {
  currency: string;
  spend_native: number;   // trailing-12mo supplier PO spend — input-cost side
  po_count: number;
  revenue_native: number; // trailing-12mo invoiced revenue — demand side
  invoice_count: number;
}

export async function readEconomicExposure(db: D1Database, tenantId: string): Promise<EconomicExposureLeg[]> {
  const legs = new Map<string, EconomicExposureLeg>();
  const leg = (ccy: string): EconomicExposureLeg => {
    let l = legs.get(ccy);
    if (!l) { l = { currency: ccy, spend_native: 0, po_count: 0, revenue_native: 0, invoice_count: 0 }; legs.set(ccy, l); }
    return l;
  };
  try {
    const pos = await db.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM erp_purchase_orders
        WHERE tenant_id = ? AND currency IS NOT NULL AND currency != 'ZAR' AND status != 'cancelled'
          AND order_date >= date('now', '-12 months')
        GROUP BY currency`,
    ).bind(tenantId).all<{ currency: string; n: number; v: number }>();
    for (const r of pos.results || []) { const l = leg(r.currency); l.spend_native = r.v; l.po_count = r.n; }
    const inv = await db.prepare(
      `SELECT currency, COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM erp_invoices
        WHERE tenant_id = ? AND currency IS NOT NULL AND currency != 'ZAR' AND status != 'cancelled'
          AND invoice_date >= date('now', '-12 months')
        GROUP BY currency`,
    ).bind(tenantId).all<{ currency: string; n: number; v: number }>();
    for (const r of inv.results || []) { const l = leg(r.currency); l.revenue_native = r.v; l.invoice_count = r.n; }
  } catch { return []; } // table absent → no exposure card, insights still render
  return [...legs.values()].sort((a, b) => (b.spend_native + b.revenue_native) - (a.spend_native + a.revenue_native));
}

function fmtNative(n: number, ccy: string): string {
  if (n >= 1_000_000) return `${ccy} ${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `${ccy} ${(n / 1_000).toFixed(0)}k`;
  return `${ccy} ${Math.round(n).toLocaleString()}`;
}

const ECON_EXPOSURE_PERSONAS = ['cfo', 'cpo', 'cmo'] as const;

/**
 * One context card per persona lens over the same booked legs:
 * CPO = input costs (supply), CMO = foreign revenue (demand),
 * CFO = value-chain net position (natural hedge or open exposure).
 */
export function economicExposureCard(
  persona: Persona, legs: EconomicExposureLeg[], pulse: ExternalPulse | null, assessmentId: string,
): PersonaInsight | null {
  if (!(ECON_EXPOSURE_PERSONAS as readonly string[]).includes(persona) || legs.length === 0) return null;
  const side = persona === 'cpo' ? 'spend' : persona === 'cmo' ? 'revenue' : 'net';
  const active = legs.filter((l) => (side === 'spend' ? l.spend_native > 0 : side === 'revenue' ? l.revenue_native > 0 : true));
  if (active.length === 0) return null;

  let headline: string;
  let bits: string[];
  if (side === 'spend') {
    headline = `Foreign-currency input costs (12mo): ${active.map((l) => fmtNative(l.spend_native, l.currency)).join(' · ')}`;
    bits = active.map((l) => `${fmtNative(l.spend_native, l.currency)} across ${l.po_count} purchase order${l.po_count === 1 ? '' : 's'}`);
  } else if (side === 'revenue') {
    headline = `Foreign-currency revenue (12mo): ${active.map((l) => fmtNative(l.revenue_native, l.currency)).join(' · ')}`;
    bits = active.map((l) => `${fmtNative(l.revenue_native, l.currency)} across ${l.invoice_count} invoice${l.invoice_count === 1 ? '' : 's'}`);
  } else {
    headline = `Value-chain currency position (12mo): ${active.map((l) => {
      const net = l.revenue_native - l.spend_native;
      return `${l.currency} ${net >= 0 ? '+' : '−'}${fmtNative(Math.abs(net), l.currency).slice(l.currency.length + 1)}`;
    }).join(' · ')}`;
    bits = active.map((l) => {
      const net = l.revenue_native - l.spend_native;
      const dir = net > 0 ? 'revenue exceeds spend by' : net < 0 ? 'spend exceeds revenue by' : 'revenue and spend offset —';
      return `${l.currency}: earns ${fmtNative(l.revenue_native, l.currency)}, spends ${fmtNative(l.spend_native, l.currency)} — ${dir} ${fmtNative(Math.abs(net), l.currency)}`;
    });
  }

  const usdLeg = active.some((l) => l.currency === 'USD');
  const fx = usdLeg ? pulse?.fx ?? null : null;
  const rateBit = fx
    ? ` USD/ZAR ${fx.value}${fx.change_pct !== null ? ` (${fx.change_pct > 0 ? '+' : ''}${fx.change_pct}%)` : ''} as of ${fx.as_of}.`
    : '';

  // Suggestions: deterministic pairing of the booked leg with the live signal.
  // Always conditional ("potential effect") — the reader draws the conclusion.
  const suggestions: string[] = [];
  if (fx && fx.direction !== 'flat') {
    const weaker = fx.direction === 'up'; // ZAR per USD rising = rand weakening
    if (side === 'spend') {
      suggestions.push(weaker
        ? 'Potential effect: a weaker rand raises the cost of this imported spend — consider reviewing supplier contracts and forward-cover options.'
        : 'Potential effect: a stronger rand lowers the cost of this imported spend — a window to negotiate pricing or bring forward orders.');
    } else if (side === 'revenue') {
      suggestions.push(weaker
        ? 'Potential effect: a weaker rand lifts the rand value of this foreign revenue.'
        : 'Potential effect: a stronger rand reduces the rand value of this foreign revenue — watch pricing and margins.');
    } else {
      suggestions.push('Where inflows and outflows share a currency they partly offset (a natural hedge); the open leg carries the rate risk.');
    }
  }
  if (side !== 'revenue' && pulse?.cpi) {
    suggestions.push(`SA CPI inflation ${pulse.cpi.value}% (${pulse.cpi.as_of}) adds domestic input-cost pressure on top of any currency move.`);
  }
  const news = pulse?.news_latest;
  const newsBit = news ? ` In the news: “${news.title}” (${news.domain}, ${news.date}).` : '';

  return {
    id: `${persona}:econ_exposure:${assessmentId}`,
    persona,
    severity: 'low',
    headline,
    detail: `Booked ${side === 'spend' ? 'supplier spend' : side === 'revenue' ? 'invoiced revenue' : 'flows'} from your ERP records, native currency.` +
      ` ${bits.join(' · ')}.${rateBit}${suggestions.length ? ` ${suggestions.join(' ')}` : ''}${newsBit}` +
      ' Context only — no Rand impact is calculated from these figures.',
    value_zar: null,
    value_kind: 'context',
    source: { assessment_id: assessmentId, ...(fx ? { external_signal_id: fx.signal_id } : {}) },
    ...(fx ? {
      external_context: {
        signal: fx.signal_key,
        value: `${fx.value} ${fx.unit}`.trim(),
        direction: fx.direction,
        note: `As of ${fx.as_of}. Context only — not included in any Rand figure.`,
      },
    } : {}),
    cta: { label: 'View findings', route: '/findings' },
  };
}

function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    // Confirmed value ranks; gate-failed values are unproven so rank as 0.
    const av = a.confidence_gate_passed !== false ? a.value_at_risk_zar : 0;
    const bv = b.confidence_gate_passed !== false ? b.value_at_risk_zar : 0;
    return bv - av;
  });
}

// ── CEO fixed 5-card set (§4.7) ─────────────────────────────────────────────

const CEO_CONCENTRATION_CODES: FindingCode[] = [
  'ar_top_debtor_concentration', 'proc_supplier_concentration', 'sales_customer_concentration',
];

async function buildCeoCards(
  db: D1Database, tenantId: string, assessmentId: string,
  findings: Finding[], summary: ReturnType<typeof summariseFindings>,
  pulse: ExternalPulse | null,
): Promise<PersonaInsight[]> {
  const cards: PersonaInsight[] = [];

  // 1. Headline rollup — same gated numbers as the journey spine.
  let recovered = 0;
  try {
    const r = await db.prepare(
      'SELECT COALESCE(SUM(total_value_processed), 0) AS v FROM catalyst_effectiveness WHERE tenant_id = ?',
    ).bind(tenantId).first<{ v: number }>();
    recovered = r?.v ?? 0;
  } catch { /* table absent → recovered stays 0 */ }
  const unverifiedNote = summary.potential_unverified_zar > 0
    ? ` A further ${fmtZar(summary.potential_unverified_zar)} is unverified pending more data.`
    : '';
  cards.push({
    id: `ceo:headline:${assessmentId}`,
    persona: 'ceo',
    severity: summary.by_severity.critical > 0 ? 'critical' : summary.by_severity.high > 0 ? 'high' : 'medium',
    headline: `${fmtZar(summary.total_value_at_risk_zar)} confirmed value at risk across ${summary.total_count} findings`,
    detail: `Gate-passed confirmed exposure is ${fmtZar(summary.total_value_at_risk_zar)}.` +
      (recovered > 0 ? ` Catalysts have processed ${fmtZar(recovered)} to date.` : '') + unverifiedNote,
    value_zar: summary.total_value_at_risk_zar,
    value_kind: 'confirmed',
    source: { assessment_id: assessmentId },
    cta: { label: 'View all findings', route: '/findings' },
  });

  // 2. Concentration trio — existential risks (top debtor / supplier / customer).
  const trio = findings.filter((f) => CEO_CONCENTRATION_CODES.includes(f.code));
  if (trio.length > 0) {
    const confirmed = trio.filter((f) => f.confidence_gate_passed !== false);
    const confirmedValue = confirmed.reduce((s, f) => s + f.value_at_risk_zar, 0);
    const worst = rankFindings(trio)[0];
    cards.push({
      id: `ceo:concentration:${assessmentId}`,
      persona: 'ceo',
      severity: worst.severity,
      headline: `Concentration risk in ${trio.length} area${trio.length > 1 ? 's' : ''}: ${trio.map((f) => f.code.includes('debtor') ? 'debtors' : f.code.includes('supplier') ? 'suppliers' : 'customers').join(', ')}`,
      detail: trio.map((f) => f.title).join(' · '),
      value_zar: confirmed.length > 0 ? confirmedValue : null,
      value_kind: confirmed.length > 0 ? 'confirmed' : 'potential_unverified',
      source: { finding_code: worst.code, assessment_id: assessmentId },
      recommended_catalyst: { cluster: worst.recommended_catalyst.catalyst, sub_catalyst: worst.recommended_catalyst.sub_catalyst },
      cta: { label: 'View concentration findings', route: `/findings?code=${worst.code}` },
    });
  }

  // 3. Biggest single finding by confirmed ZAR.
  const biggest = [...findings]
    .filter((f) => f.confidence_gate_passed !== false)
    .sort((a, b) => b.value_at_risk_zar - a.value_at_risk_zar)[0];
  if (biggest) {
    const card = insightFromFinding('ceo', biggest, assessmentId);
    cards.push({ ...card, id: `ceo:biggest:${assessmentId}`, cta: { label: 'Assign to owner', route: `/findings?code=${biggest.code}` } });
  }

  // 4. Decision needed — highest-value pending catalyst approval (escalations first).
  try {
    const pending = await db.prepare(
      `SELECT id, catalyst_name, action, confidence, input_data, escalation_level, created_at
         FROM catalyst_actions
        WHERE tenant_id = ? AND status IN ('pending_approval', 'escalated')
        ORDER BY escalation_level DESC, created_at DESC LIMIT 25`,
    ).bind(tenantId).all<{
      id: string; catalyst_name: string; action: string; confidence: number;
      input_data: string | null; escalation_level: number | null; created_at: string;
    }>();
    const rows = pending.results || [];
    if (rows.length > 0) {
      // Rank by any ZAR value carried in input_data; fall back to escalation order.
      const valued = rows.map((r) => {
        let v = 0;
        try {
          const d = JSON.parse(r.input_data || '{}') as Record<string, unknown>;
          for (const k of ['value_at_risk_zar', 'amount_zar', 'value_zar', 'amount']) {
            if (typeof d[k] === 'number') { v = d[k] as number; break; }
          }
        } catch { /* unparseable input_data → value 0 */ }
        return { r, v };
      }).sort((a, b) => b.v - a.v);
      const top = valued[0];
      cards.push({
        id: `ceo:decision:${assessmentId}:${top.r.id}`,
        persona: 'ceo',
        severity: (top.r.escalation_level ?? 0) > 0 ? 'high' : 'medium',
        headline: `Decision needed: ${top.r.catalyst_name} — ${top.r.action}`,
        detail: `${rows.length} catalyst action${rows.length > 1 ? 's' : ''} awaiting approval.` +
          (top.v > 0 ? ` Highest-value item carries ${fmtZar(top.v)} (action value, not a gated finding — approve to act on it).` : ''),
        // Honesty: action values are not gate-passed finding values — never 'confirmed'.
        value_zar: null,
        value_kind: 'context',
        source: { assessment_id: assessmentId },
        cta: { label: 'Review approvals', route: '/catalysts' },
      });
    }
  } catch { /* catalyst_actions absent → no decision card */ }

  // 5. External pulse — one-line macro strip, context only, no ZAR attached.
  if (pulse) {
    const bits: string[] = [];
    if (pulse.fx) bits.push(`USD/ZAR ${pulse.fx.value}${pulse.fx.change_pct !== null ? ` (${pulse.fx.change_pct > 0 ? '+' : ''}${pulse.fx.change_pct}%)` : ''}`);
    if (pulse.brent) bits.push(`Brent ${pulse.brent.value} ${pulse.brent.unit}`.trim());
    if (pulse.cpi) bits.push(`CPI ${pulse.cpi.value}%`);
    if (pulse.gdp) bits.push(`GDP ${pulse.gdp.value}%`);
    if (pulse.news_latest) bits.push(`News: ${pulse.news_latest.title}`);
    if (pulse.regulatory_latest) bits.push(`Reg: ${pulse.regulatory_latest.title}`);
    const primary = pulse.fx || pulse.brent;
    cards.push({
      id: `ceo:pulse:${assessmentId}`,
      persona: 'ceo',
      severity: 'low',
      headline: bits.join(' · '),
      detail: 'External market pulse. Context only — no Rand impact is calculated from these signals.',
      value_zar: null,
      value_kind: 'context',
      source: { assessment_id: assessmentId, ...(primary ? { external_signal_id: primary.signal_id } : {}) },
      ...(primary ? {
        external_context: {
          signal: primary.signal_key,
          value: `${primary.value} ${primary.unit}`.trim(),
          direction: primary.direction,
          note: `As of ${primary.as_of}.`,
        },
      } : {}),
      cta: { label: 'View findings', route: '/findings' },
    });
  }

  return cards.slice(0, 5);
}

// ── CIO platform-posture cards (§4.6) ───────────────────────────────────────

async function buildCioCards(db: D1Database, tenantId: string, assessmentId: string): Promise<PersonaInsight[]> {
  const cards: PersonaInsight[] = [];
  const safe = async <T extends Record<string, unknown>>(sql: string): Promise<T | null> => {
    try { return await db.prepare(sql).bind(tenantId).first<T>(); } catch { return null; }
  };

  const conns = await safe<{ total: number; errors: number; connected: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('error', 'failed') THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM erp_connections WHERE tenant_id = ?`,
  );
  if (conns && conns.total > 0) {
    cards.push({
      id: `cio:connections:${assessmentId}`,
      persona: 'cio',
      severity: (conns.errors ?? 0) > 0 ? 'high' : 'low',
      headline: (conns.errors ?? 0) > 0
        ? `${conns.errors} of ${conns.total} ERP connections in error`
        : `All ${conns.total} ERP connections healthy`,
      detail: `${conns.connected ?? 0} connected, ${conns.errors ?? 0} in error, ${conns.total} total.`,
      value_zar: null,
      value_kind: 'context',
      source: { assessment_id: assessmentId },
      cta: { label: 'View connections', route: '/data' },
    });
  }

  const datasets = await safe<{ total: number; failed: number }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM assessment_datasets WHERE tenant_id = ?`,
  );
  if (datasets && datasets.total > 0) {
    cards.push({
      id: `cio:datasets:${assessmentId}`,
      persona: 'cio',
      severity: (datasets.failed ?? 0) > 0 ? 'medium' : 'low',
      headline: (datasets.failed ?? 0) > 0
        ? `${datasets.failed} of ${datasets.total} ingest datasets failed`
        : `${datasets.total} ingest datasets, none failed`,
      detail: `Dataset ingest failure rate: ${datasets.total > 0 ? Math.round(((datasets.failed ?? 0) / datasets.total) * 100) : 0}%.`,
      value_zar: null,
      value_kind: 'context',
      source: { assessment_id: assessmentId },
      cta: { label: 'View data ingest', route: '/data' },
    });
  }

  const actions = await safe<{ total: number; completed: number; pending: number; auto: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status IN ('pending_approval', 'escalated') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'completed' AND (approved_by IS NULL OR approved_by = '') THEN 1 ELSE 0 END) AS auto
       FROM catalyst_actions WHERE tenant_id = ?`,
  );
  if (actions && actions.total > 0) {
    const rate = Math.round(((actions.auto ?? 0) / actions.total) * 100);
    cards.push({
      id: `cio:automation:${assessmentId}`,
      persona: 'cio',
      severity: 'low',
      headline: `Catalyst automation rate ${rate}% (${actions.auto ?? 0} of ${actions.total} auto-executed)`,
      detail: `${actions.completed ?? 0} completed, ${actions.pending ?? 0} awaiting approval.`,
      value_zar: null,
      value_kind: 'context',
      source: { assessment_id: assessmentId },
      cta: { label: 'View catalysts', route: '/catalysts' },
    });
  }

  return cards.slice(0, 5);
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Build the persona insight payload for one tenant.
 * Loads the latest COMPLETE assessment (same rule as the frontend
 * latestCompleteAssessment helper: newest status='complete' by created_at).
 */
export async function buildPersonaInsights(
  db: D1Database, tenantId: string, persona: Persona,
): Promise<PersonaInsightsResponse> {
  const pulse = await readExternalPulse(db, tenantId);

  const row = await db.prepare(
    `SELECT id, results FROM assessments
      WHERE tenant_id = ? AND status = 'complete'
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(tenantId).first<{ id: string; results: string | null }>();

  if (!row) {
    return { persona, generated_from_assessment_id: null, insights: [], external_pulse: pulse };
  }

  let findings: Finding[] = [];
  let summary: ReturnType<typeof summariseFindings> | null = null;
  try {
    const results = JSON.parse(row.results || '{}') as {
      findings?: Finding[];
      findings_summary?: ReturnType<typeof summariseFindings>;
    };
    findings = Array.isArray(results.findings) ? results.findings : [];
    summary = results.findings_summary ?? null;
  } catch { /* corrupt results → treat as no findings */ }
  if (!summary) summary = summariseFindings(findings);

  if (persona === 'cio') {
    return {
      persona,
      generated_from_assessment_id: row.id,
      insights: await buildCioCards(db, tenantId, row.id),
      external_pulse: pulse,
    };
  }

  if (persona === 'ceo') {
    return {
      persona,
      generated_from_assessment_id: row.id,
      insights: await buildCeoCards(db, tenantId, row.id, findings, summary, pulse),
      external_pulse: pulse,
    };
  }

  const codeSet = new Set<FindingCode>(PERSONA_SIGNAL_MAP[persona]);
  const matched = rankFindings(findings.filter((f) => codeSet.has(f.code))).slice(0, 8);
  const insights = matched.map((f) => attachExternalContext(insightFromFinding(persona, f, row.id), pulse));

  // Economic exposure — booked supply/demand/net legs paired with the live pulse.
  if ((ECON_EXPOSURE_PERSONAS as readonly string[]).includes(persona)) {
    const econ = economicExposureCard(persona, await readEconomicExposure(db, tenantId), pulse, row.id);
    if (econ) insights.push(econ);
  }

  return { persona, generated_from_assessment_id: row.id, insights, external_pulse: pulse };
}
