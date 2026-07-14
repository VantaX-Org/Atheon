/**
 * Persona Insight Dashboards — Track A backend tests.
 *
 * 1. Lock test: every code in PERSONA_SIGNAL_MAP is a real FindingCode, and
 *    the union of the five functional personas (cfo/cpo/cmo/coo/chro) covers
 *    all 40 finding codes — a new detector must be assigned to a persona or
 *    this fails. CEO (rollup) and CIO (platform posture) are exempt.
 * 2. Honesty test: gate-failed findings surface as potential_unverified with
 *    value_zar null; external context is always value_kind 'context' with
 *    value_zar null — never summed into ZAR.
 * 3. Route test: invalid persona → 400; valid persona → 200 for allowed roles.
 *
 * All seeding lives in one file-level beforeAll — vitest-pool-workers rolls
 * back suite-scoped beforeAll writes between describes (same reason
 * compliance-authz.test.ts seeds at file level).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:test';
import { createTestUser, loginUser, authedRequest } from './helpers';
import { ensureMigrated } from './setup';
import {
  PERSONAS,
  PERSONA_SIGNAL_MAP,
  EXTERNAL_RELEVANCE_MAP,
  insightFromFinding,
  buildPersonaInsights,
  type Persona,
} from '../services/persona-insights';
import { FINDING_INFERENCE_KIND, type Finding, type FindingCode } from '../services/assessment-findings';

const ALL_CODES = Object.keys(FINDING_INFERENCE_KIND) as FindingCode[];

const SEEDED_TENANT = `persona-seeded-${randomUUID().slice(0, 8)}`;
const EMPTY_TENANT = `persona-empty-${randomUUID().slice(0, 8)}`;
const ASSESSMENT_ID = randomUUID();

const exec = {
  email: `persona-exec-${randomUUID().slice(0, 8)}@vantax.co.za`,
  password: 'Exec123!x',
  name: 'Persona Exec',
  role: 'executive',
  tenantId: EMPTY_TENANT,
};
const viewer = {
  email: `persona-viewer-${randomUUID().slice(0, 8)}@vantax.co.za`,
  password: 'Viewer123!x',
  name: 'Persona Viewer',
  role: 'viewer',
  tenantId: EMPTY_TENANT,
};
let execToken: string;
let viewerToken: string;

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: randomUUID(),
    code: 'ar_aging_overdue_90_plus',
    category: 'finance',
    severity: 'high',
    title: 'R1.24m sitting in invoices 90+ days overdue',
    narrative: 'Test narrative.',
    affected_count: 12,
    value_at_risk_zar: 1_240_000,
    value_components: [],
    currency_breakdown: {},
    sample_records: [],
    recommended_catalyst: { catalyst: 'finance', sub_catalyst: 'ar-collections' },
    metric_signature: 'ar_aging_overdue_90_plus',
    evidence_quality: 'high',
    confidence: 0.95,
    confidence_explanation: 'Direct observation.',
    confidence_gate_passed: true,
    detected_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureMigrated();
  for (const id of [SEEDED_TENANT, EMPTY_TENANT]) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    ).bind(id, id, id).run();
  }
  await createTestUser(exec);
  await createTestUser(viewer);
  const et = await loginUser(exec.email, exec.password);
  const vt = await loginUser(viewer.email, viewer.password);
  if (!et || !vt) throw new Error('test user login failed');
  execToken = et;
  viewerToken = vt;

  const results = {
    findings: [
      makeFinding({ code: 'fx_currency_exposure', category: 'cross_cutting', severity: 'medium' }),
      makeFinding({ code: 'ar_aging_overdue_90_plus', severity: 'critical' }),
      makeFinding({
        code: 'gl_suspense_balance', severity: 'high',
        confidence_gate_passed: false, confidence: 0.4, value_at_risk_zar: 500_000,
      }),
    ],
  };
  await env.DB.prepare(
    `INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, status, results, created_by)
     VALUES (?, ?, 'Test Co', 'technology', 'complete', ?, 'test')`,
  ).bind(ASSESSMENT_ID, SEEDED_TENANT, JSON.stringify(results)).run();
  // One FX signal row (same raw_data shape as external-signals-feed.ts).
  await env.DB.prepare(
    `INSERT INTO external_signals (id, tenant_id, category, title, summary, source_url, source_name,
       reliability_score, relevance_score, sentiment, raw_data, detected_at)
     VALUES (?, ?, 'market', 'FX: USD/ZAR', 'test', '', 'frankfurter', 0.9, 0.9, 'neutral', ?, datetime('now'))`,
  ).bind(randomUUID(), SEEDED_TENANT, JSON.stringify({
    signal_key: 'fx.usd_zar', latest_value: 18.72, latest_date: '2026-07-13', unit: 'ZAR per USD',
    history: [{ date: '2026-07-12', value: 18.5 }],
  })).run();
});

describe('PERSONA_SIGNAL_MAP lock', () => {
  it('every mapped code is a real FindingCode', () => {
    for (const persona of PERSONAS) {
      for (const code of PERSONA_SIGNAL_MAP[persona]) {
        expect(FINDING_INFERENCE_KIND[code], `${persona} maps unknown code ${code}`).toBeDefined();
      }
    }
  });

  it('every EXTERNAL_RELEVANCE_MAP code is a real FindingCode', () => {
    for (const codes of Object.values(EXTERNAL_RELEVANCE_MAP)) {
      for (const code of codes) {
        expect(FINDING_INFERENCE_KIND[code], `external relevance maps unknown code ${code}`).toBeDefined();
      }
    }
  });

  it('all 40 finding codes are owned by at least one functional persona', () => {
    const functional: Persona[] = ['cfo', 'cpo', 'cmo', 'coo', 'chro'];
    const covered = new Set<FindingCode>(functional.flatMap((p) => PERSONA_SIGNAL_MAP[p]));
    const orphans = ALL_CODES.filter((c) => !covered.has(c));
    expect(orphans, `finding codes with no persona owner: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('honesty rules', () => {
  it('gate-passed finding maps to confirmed with value_zar', () => {
    const insight = insightFromFinding('cfo', makeFinding(), 'assess-1');
    expect(insight.value_kind).toBe('confirmed');
    expect(insight.value_zar).toBe(1_240_000);
    expect(insight.cta.route).toBe('/findings?code=ar_aging_overdue_90_plus');
  });

  it('gate-failed finding maps to potential_unverified with value_zar null', () => {
    const insight = insightFromFinding('cfo', makeFinding({ confidence_gate_passed: false, confidence: 0.42 }), 'assess-1');
    expect(insight.value_kind).toBe('potential_unverified');
    expect(insight.value_zar).toBeNull();
  });
});

describe('buildPersonaInsights (D1 integration)', () => {
  it('filters to the persona set, ranks by severity, and gates values', async () => {
    const res = await buildPersonaInsights(env.DB, SEEDED_TENANT, 'cfo');
    expect(res.generated_from_assessment_id).toBe(ASSESSMENT_ID);
    expect(res.insights.length).toBe(3);
    // Ranked: critical AR first.
    expect(res.insights[0].source.finding_code).toBe('ar_aging_overdue_90_plus');
    expect(res.insights[0].value_kind).toBe('confirmed');
    // Gate-failed GL suspense → unverified, no ZAR claimed.
    const gl = res.insights.find((i) => i.source.finding_code === 'gl_suspense_balance');
    expect(gl?.value_kind).toBe('potential_unverified');
    expect(gl?.value_zar).toBeNull();
  });

  it('attaches FX external context without touching value_zar', async () => {
    const res = await buildPersonaInsights(env.DB, SEEDED_TENANT, 'cfo');
    const fx = res.insights.find((i) => i.source.finding_code === 'fx_currency_exposure');
    expect(fx?.external_context?.signal).toBe('fx.usd_zar');
    expect(fx?.external_context?.direction).toBe('up');
    // Context never changes the confirmed value.
    expect(fx?.value_zar).toBe(1_240_000);
    expect(res.external_pulse?.fx?.value).toBe(18.72);
  });

  it('CEO pulse + decision cards are context-only (value_zar null)', async () => {
    const res = await buildPersonaInsights(env.DB, SEEDED_TENANT, 'ceo');
    for (const card of res.insights.filter((i) => i.value_kind === 'context')) {
      expect(card.value_zar).toBeNull();
    }
    // Headline card is confirmed-only arithmetic.
    const headline = res.insights.find((i) => i.id.startsWith('ceo:headline'));
    expect(headline?.value_zar).toBe(2_480_000); // two gate-passed findings, gl excluded
  });
});

describe('GET /api/insights role + persona validation', () => {
  it('400 on invalid persona', async () => {
    const res = await authedRequest('/api/insights?persona=intern', execToken);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/persona/i);
  });

  it('400 on missing persona', async () => {
    const res = await authedRequest('/api/insights', execToken);
    expect(res.status).toBe(400);
  });

  it('200 with empty insights for an executive with no assessments', async () => {
    const res = await authedRequest('/api/insights?persona=cfo', execToken);
    expect(res.status).toBe(200);
    const body = await res.json() as { persona: string; generated_from_assessment_id: string | null; insights: unknown[] };
    expect(body.persona).toBe('cfo');
    expect(body.generated_from_assessment_id).toBeNull();
    expect(body.insights).toEqual([]);
  });

  it('403 for a viewer', async () => {
    const res = await authedRequest('/api/insights?persona=cfo', viewerToken);
    expect(res.status).toBe(403);
  });
});
