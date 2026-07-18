/**
 * insights-engine.ts unit tests.
 *
 * Independent oracles: dimension math, health-score scoring, and the
 * deterministic insight/threshold logic are all hand-computed here rather
 * than derived from the implementation. DB-backed generators are seeded with
 * minimal rows and asserted on the parts that are deterministic (counts,
 * ordering, thresholds, weighted-average health math, deterministic LLM
 * fallbacks forced by a throwing AI binding).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  getDimensionsForDomain,
  collectRunInsights,
  bridgeKpisToProcessMetrics,
  recalculateHealthScoreFromKpis,
  generatePulseInsights,
  generateApexInsights,
  generateDashboardIntelligence,
  type RunInsightContext,
} from '../services/insights-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';

// A fake AI binding that always throws — forces the deterministic
// non-LLM fallback paths in the generator functions.
const throwingAi = { run: async () => { throw new Error('no ai in test'); } } as unknown as Ai;

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

async function seedCluster(id: string, tenantId: string, domain: string, status: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, success_rate, autonomy_tier)
     VALUES (?, ?, ?, ?, ?, 0, 'read-only')`
  ).bind(id, tenantId, id, domain, status).run();
}

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  expect(res.status).toBeLessThan(500);
});

// ──────────────────────────────────────────────────────────────────────────
// getDimensionsForDomain — PURE
// ──────────────────────────────────────────────────────────────────────────
describe('getDimensionsForDomain', () => {
  it('maps known single-dimension domains', () => {
    expect(getDimensionsForDomain('finance')).toEqual(['financial']);
    expect(getDimensionsForDomain('operations')).toEqual(['operational']);
    expect(getDimensionsForDomain('tech-devops')).toEqual(['technology']);
  });

  it('maps known multi-dimension domains', () => {
    expect(getDimensionsForDomain('procurement')).toEqual(['operational', 'financial']);
    expect(getDimensionsForDomain('tech-security')).toEqual(['technology', 'compliance']);
    expect(getDimensionsForDomain('hr')).toEqual(['operational', 'strategic']);
  });

  it('empty domain falls back to operational', () => {
    expect(getDimensionsForDomain('')).toEqual(['operational']);
  });

  it('unknown domain is slugified into its own dimension', () => {
    expect(getDimensionsForDomain('ESG Water')).toEqual(['esg-water']);
    expect(getDimensionsForDomain('  Sustainability!!  ')).toEqual(['sustainability']);
    // A string with no alphanumerics slugs to '' → operational fallback.
    expect(getDimensionsForDomain('---')).toEqual(['operational']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// collectRunInsights — deterministic threshold/movement/trend logic
// ──────────────────────────────────────────────────────────────────────────
describe('collectRunInsights', () => {
  const TENANT = 'ie-collect';
  const CLUSTER = 'ie-collect-cluster';

  beforeAll(async () => {
    await seedTenant(TENANT);
    await seedCluster(CLUSTER, TENANT, 'finance', 'inactive');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_insights WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM risk_alerts WHERE tenant_id = ?').bind(TENANT).run();
  });

  function baseCtx(): RunInsightContext {
    return {
      tenantId: TENANT,
      clusterId: CLUSTER,
      subCatalystName: 'AR Recon',
      runId: 'run-collect-1',
      domain: 'finance',
      runData: {
        status: 'completed',
        matched: 50, discrepancies: 100, exceptions: 20,
        totalSourceValue: 1_000_000, totalDiscrepancyValue: 300_000, totalUnmatchedValue: 5_000,
        matchRate: 50, discrepancyRate: 30, exceptionRate: 20,
        confidence: 0.9, duration_ms: 1000,
      },
      previousRunData: { matched: 90, discrepancies: 10, exceptions: 5, matchRate: 95, totalSourceValue: 900_000 },
      kpiValues: [
        { name: 'DSO', category: 'financial', value: 99, status: 'red' },
        { name: 'Throughput', category: 'operational', value: 120, status: 'green', previousValue: 100 },
      ],
    };
  }

  it('produces the exact hand-counted insight set for an all-critical run', async () => {
    // Oracle:
    //  issues: discrepancyRate 30(>25 crit), matchRate 50(<60 crit),
    //          exceptionRate 20(>15 crit), discValue 300k(>250k crit) = 4 critical
    //  kpi:    DSO red = 1 critical; Throughput +20% change = 1 info
    //  trends: matchDelta -45 (declining>10 warn) = 1 warning;
    //          discDelta +90 (increasing warn, apex) = 1 warning
    //  → 8 total: 5 critical, 2 warning, 1 info
    const insights = await collectRunInsights(env.DB, baseCtx());
    expect(insights).toHaveLength(8);
    expect(insights.filter(i => i.severity === 'critical')).toHaveLength(5);
    expect(insights.filter(i => i.severity === 'warning')).toHaveLength(2);
    expect(insights.filter(i => i.severity === 'info')).toHaveLength(1);
    expect(insights.filter(i => i.category === 'issue_detected')).toHaveLength(4);
    expect(insights.filter(i => i.category === 'kpi_movement')).toHaveLength(2);
    expect(insights.filter(i => i.category === 'trend_change')).toHaveLength(2);

    // The large-financial-discrepancy issue and the increasing-discrepancy
    // trend are escalated to apex level; everything else stays pulse.
    expect(insights.filter(i => i.insight_level === 'apex')).toHaveLength(2);

    // All 8 persisted to catalyst_insights.
    const stored = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM catalyst_insights WHERE tenant_id = ?'
    ).bind(TENANT).first<{ c: number }>();
    expect(stored?.c).toBe(8);

    // One risk_alert auto-generated per critical insight (5).
    const alerts = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM risk_alerts WHERE tenant_id = ?'
    ).bind(TENANT).first<{ c: number }>();
    expect(alerts?.c).toBe(5);
  });

  it('returns no insights when everything is within thresholds', async () => {
    const ctx = baseCtx();
    ctx.runData = {
      ...ctx.runData,
      matched: 98, discrepancies: 1, exceptions: 1,
      matchRate: 95, discrepancyRate: 2, exceptionRate: 1,
      totalDiscrepancyValue: 1000,
    };
    ctx.previousRunData = null;
    ctx.kpiValues = [{ name: 'X', category: 'financial', value: 50, status: 'green' }];

    const insights = await collectRunInsights(env.DB, ctx);
    expect(insights).toHaveLength(0);

    const stored = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM catalyst_insights WHERE tenant_id = ?'
    ).bind(TENANT).first<{ c: number }>();
    expect(stored?.c).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// bridgeKpisToProcessMetrics
// ──────────────────────────────────────────────────────────────────────────
describe('bridgeKpisToProcessMetrics', () => {
  const TENANT = 'ie-bridge';
  const CLUSTER = 'ie-bridge-cluster';
  const SUB = 'AR Recon';

  beforeAll(async () => {
    await seedTenant(TENANT);
    await seedCluster(CLUSTER, TENANT, 'finance', 'inactive');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM sub_catalyst_kpi_values WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM sub_catalyst_kpi_definitions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  async function seedDef(id: string, kpiName: string, category: string, enabled: number, sort: number): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO sub_catalyst_kpi_definitions
         (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, unit, category, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, '%', ?, ?, ?)`
    ).bind(id, TENANT, CLUSTER, SUB, kpiName, category, enabled, sort).run();
  }
  async function seedVal(id: string, defId: string, value: number, status: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO sub_catalyst_kpi_values (id, tenant_id, definition_id, run_id, value, status)
       VALUES (?, ?, ?, NULL, ?, ?)`
    ).bind(id, TENANT, defId, value, status).run();
  }

  it('bridges only enabled definitions that have a latest value', async () => {
    await seedDef('d1', 'Match Rate', 'operational', 1, 0);
    await seedVal('v1', 'd1', 85, 'amber');
    await seedDef('d2', 'No Value', 'financial', 1, 1); // enabled, no value → skipped
    await seedDef('d3', 'Disabled', 'operational', 0, 2); // disabled → filtered by WHERE
    await seedVal('v3', 'd3', 10, 'red');

    const bridged = await bridgeKpisToProcessMetrics(env.DB, TENANT, CLUSTER, SUB, 'run-bridge-1');
    expect(bridged).toBe(1);

    const rows = await env.DB.prepare(
      'SELECT id, name, value, status, domain, category FROM process_metrics WHERE tenant_id = ?'
    ).bind(TENANT).all<{ id: string; name: string; value: number; status: string; domain: string; category: string }>();
    expect(rows.results).toHaveLength(1);
    const m = rows.results[0];
    expect(m.id).toBe(`pm-${TENANT}-${CLUSTER}-ar-recon-match-rate`);
    expect(m.name).toBe('AR Recon: Match Rate');
    expect(m.value).toBe(85);
    expect(m.status).toBe('amber');
    expect(m.domain).toBe('finance'); // pulled from cluster
    expect(m.category).toBe('operational');
  });

  it('returns 0 when there are no definitions', async () => {
    const bridged = await bridgeKpisToProcessMetrics(env.DB, TENANT, CLUSTER, 'Nonexistent Sub', 'run-x');
    expect(bridged).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// recalculateHealthScoreFromKpis — hand-computed scoring math
// ──────────────────────────────────────────────────────────────────────────
describe('recalculateHealthScoreFromKpis', () => {
  const TENANT = 'ie-health';
  const CLUSTER = 'ie-health-cluster';

  beforeAll(async () => {
    await seedTenant(TENANT);
    // Cluster is INACTIVE so it contributes no 'catalyst' dimension —
    // it exists only to satisfy the KPI-definition FK.
    await seedCluster(CLUSTER, TENANT, 'finance', 'inactive');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM sub_catalyst_kpi_values WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM sub_catalyst_kpi_definitions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM risk_alerts WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM anomalies WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM health_scores WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM health_score_history WHERE tenant_id = ?').bind(TENANT).run();
  });

  let defCounter = 0;
  async function seedKpi(category: string, status: string): Promise<void> {
    const id = `hdef-${defCounter++}`;
    await env.DB.prepare(
      `INSERT INTO sub_catalyst_kpi_definitions
         (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, unit, category, enabled, sort_order)
       VALUES (?, ?, ?, 'Sub', ?, '%', ?, 1, 0)`
    ).bind(id, TENANT, CLUSTER, `${id}-kpi`, category).run();
    await env.DB.prepare(
      `INSERT INTO sub_catalyst_kpi_values (id, tenant_id, definition_id, run_id, value, status)
       VALUES (?, ?, ?, NULL, 1, ?)`
    ).bind(`hval-${id}`, TENANT, id, status).run();
  }

  it('returns null when the tenant has no data', async () => {
    const result = await recalculateHealthScoreFromKpis(env.DB, 'ie-health-empty-tenant');
    expect(result).toBeNull();
  });

  it('scores a single dimension: (green*100+amber*50)/count, overall = that score', async () => {
    // financial: 4 green + 1 red → (400+0)/5 = 80. Only dimension → overall 80.
    for (let i = 0; i < 4; i++) await seedKpi('financial', 'green');
    await seedKpi('financial', 'red');

    const result = await recalculateHealthScoreFromKpis(env.DB, TENANT);
    expect(result).not.toBeNull();
    const dims = result!.dimensions as Record<string, { score: number; kpiContributors: Array<{ status: string; count: number }> }>;
    expect(dims.financial.score).toBe(80);
    expect(dims.financial.kpiContributors).toEqual([
      { status: 'green', count: 4 },
      { status: 'amber', count: 0 },
      { status: 'red', count: 1 },
    ]);
    expect(result!.overall).toBe(80);
  });

  it('weighted composite across financial (0.25) and risk (0.1)', async () => {
    // financial: 4 green + 1 red → 80, weight 0.25
    for (let i = 0; i < 4; i++) await seedKpi('financial', 'green');
    await seedKpi('financial', 'red');
    // risk_alerts: 1 critical (penalty 20) + 1 high (penalty 10) → score 70, weight 0.1
    await env.DB.prepare(
      `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, status)
       VALUES ('rk1', ?, 't1', 'd1', 'critical', 'finance', 'active')`
    ).bind(TENANT).run();
    await env.DB.prepare(
      `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, status)
       VALUES ('rk2', ?, 't2', 'd2', 'high', 'finance', 'active')`
    ).bind(TENANT).run();

    const result = await recalculateHealthScoreFromKpis(env.DB, TENANT);
    const dims = result!.dimensions as Record<string, { score: number }>;
    expect(dims.financial.score).toBe(80);
    expect(dims.risk.score).toBe(70);
    // overall = round(80*(0.25/0.35) + 70*(0.10/0.35))
    //         = round(57.142857 + 20) = round(77.142857) = 77
    expect(result!.overall).toBe(77);
  });

  it('risk penalty is capped at 0 (never negative)', async () => {
    // 6 critical alerts → penalty 120 → max(0, 100-120) = 0
    for (let i = 0; i < 6; i++) {
      await env.DB.prepare(
        `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, status)
         VALUES (?, ?, 't', 'd', 'critical', 'finance', 'active')`
      ).bind(`rkc-${i}`, TENANT).run();
    }
    const result = await recalculateHealthScoreFromKpis(env.DB, TENANT);
    const dims = result!.dimensions as Record<string, { score: number }>;
    expect(dims.risk.score).toBe(0);
    // risk is the only dimension → overall equals its score.
    expect(result!.overall).toBe(0);
  });

  it('anomalies drive a process dimension with 5-per-anomaly penalty', async () => {
    // 3 open anomalies → penalty 15 → processScore 85.
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        `INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, status)
         VALUES (?, ?, 'm', 'medium', 10, 20, 10, 'open')`
      ).bind(`an-${i}`, TENANT).run();
    }
    const result = await recalculateHealthScoreFromKpis(env.DB, TENANT);
    const dims = result!.dimensions as Record<string, { score: number }>;
    expect(dims.process.score).toBe(85);
    expect(result!.overall).toBe(85);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// generateDashboardIntelligence — fully deterministic (no LLM)
// ──────────────────────────────────────────────────────────────────────────
describe('generateDashboardIntelligence', () => {
  const TENANT = 'ie-dash';

  beforeAll(async () => {
    await seedTenant(TENANT);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM health_scores WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM risk_alerts WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM catalyst_insights WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('builds summary, orders metrics red-first, and derives recommended actions', async () => {
    await env.DB.prepare(
      `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions) VALUES ('hs-dash', ?, 72, '{}')`
    ).bind(TENANT).run();

    // Metrics: one of each status — expect ordering red, amber, green.
    await env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status) VALUES ('pm-g', ?, 'Green M', 10, '%', 'green')`
    ).bind(TENANT).run();
    await env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status) VALUES ('pm-r', ?, 'Red M', 20, '%', 'red')`
    ).bind(TENANT).run();
    await env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status) VALUES ('pm-a', ?, 'Amber M', 30, '%', 'amber')`
    ).bind(TENANT).run();

    // 2 active risks.
    await env.DB.prepare(
      `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, status)
       VALUES ('rd1', ?, 'Crit Risk', 'd', 'critical', 'finance', 'active')`
    ).bind(TENANT).run();
    await env.DB.prepare(
      `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, status)
       VALUES ('rd2', ?, 'High Risk', 'd', 'high', 'finance', 'active')`
    ).bind(TENANT).run();

    // Insights this week: 1 critical, 2 warning.
    for (const [id, sev] of [['ci1', 'critical'], ['ci2', 'warning'], ['ci3', 'warning']]) {
      await env.DB.prepare(
        `INSERT INTO catalyst_insights (id, tenant_id, title, description, severity) VALUES (?, ?, 't', 'd', ?)`
      ).bind(id, TENANT, sev).run();
    }

    const result = await generateDashboardIntelligence(env.DB, throwingAi, TENANT);

    expect(result.summary).toBe(
      'Business health 72/100, trending cautious. 1 critical findings, 2 warnings this week. 1 metric(s) require immediate attention. 2 active risk alert(s).'
    );

    expect(result.keyMetrics).toHaveLength(3);
    expect(result.keyMetrics[0].status).toBe('red');
    expect(result.keyMetrics[1].status).toBe('amber');
    expect(result.keyMetrics[2].status).toBe('green');
    expect(result.keyMetrics[0].trend).toBe('declining');
    expect(result.keyMetrics[2].trend).toBe('stable');

    expect(result.topRisks).toHaveLength(2);
    expect(result.topRisks[0].severity).toBe('critical');

    expect(result.recommendedActions).toEqual([
      'Address RED metrics — view Pulse for operational detail',
      'Review active risk alerts in Apex',
      'Investigate critical insights from recent catalyst runs',
    ]);
  });

  it('with no data at all, summary shows 0 and a nominal action', async () => {
    const result = await generateDashboardIntelligence(env.DB, throwingAi, TENANT);
    expect(result.summary).toBe(
      'Business health 0/100. 0 critical findings, 0 warnings this week. 0 metric(s) require immediate attention. 0 active risk alert(s).'
    );
    expect(result.keyMetrics).toHaveLength(0);
    expect(result.recommendedActions).toEqual([
      'All systems nominal — review Pulse for optimization opportunities',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// generatePulseInsights — deterministic fallback (throwing AI)
// ──────────────────────────────────────────────────────────────────────────
describe('generatePulseInsights (LLM fallback)', () => {
  const TENANT = 'ie-pulse';

  beforeAll(async () => {
    await seedTenant(TENANT);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM catalyst_insights WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('summarises metric health and emits RED recommendations + drivers', async () => {
    const rows: Array<[string, string]> = [
      ['pm-g1', 'green'], ['pm-g2', 'green'], ['pm-a1', 'amber'], ['pm-r1', 'red'],
    ];
    for (const [id, status] of rows) {
      await env.DB.prepare(
        `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, domain)
         VALUES (?, ?, ?, 1, '%', ?, 'finance')`
      ).bind(id, TENANT, `M-${id}`, status).run();
    }

    const result = await generatePulseInsights(env.DB, throwingAi, TENANT, 'finance');

    // green 2, amber 1, red 1 → RED path.
    expect(result.insights).toBe(
      'finance department: 2 metrics healthy, 1 require attention, 1 critical. Immediate action recommended on RED metrics.'
    );
    expect(result.recommendations).toEqual([
      'Review RED metric root causes',
      'Check data source connectivity',
      'Escalate critical findings',
    ]);
    // One driver per metric (up to 5); a red metric reads as declining/negative.
    expect(result.drivers).toHaveLength(4);
    const redDriver = result.drivers.find(d => d.direction === 'declining');
    expect(redDriver).toBeDefined();
    expect(redDriver!.impact).toBe('Negative — below threshold');
  });

  it('with no metrics, returns the empty-state message and no recommendations to review', async () => {
    const result = await generatePulseInsights(env.DB, throwingAi, TENANT, 'finance');
    expect(result.insights).toBe('No operational data available yet. Run catalysts to generate insights.');
    // All-clear recommendation set (no red/amber).
    expect(result.recommendations).toEqual([
      'Maintain current operational standards',
      'Consider expanding automation',
    ]);
    expect(result.drivers).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// generateApexInsights — deterministic drivers/issues (throwing AI)
// ──────────────────────────────────────────────────────────────────────────
describe('generateApexInsights (LLM fallback)', () => {
  const TENANT = 'ie-apex';

  beforeAll(async () => {
    await seedTenant(TENANT);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM health_scores WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM catalyst_insights WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM risk_alerts WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('derives performance drivers from health dimensions and issues from insights + risks', async () => {
    const dims = {
      financial: { score: 90, trend: 'improving', delta: 5, kpiContributors: [] },
      operational: { score: 45, trend: 'declining', delta: -8, kpiContributors: [] },
    };
    await env.DB.prepare(
      `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions) VALUES ('hs-apex', ?, 68, ?)`
    ).bind(TENANT, JSON.stringify(dims)).run();

    // 1 critical insight (issue).
    await env.DB.prepare(
      `INSERT INTO catalyst_insights (id, tenant_id, title, description, severity, domain, insight_level)
       VALUES ('ai1', ?, 'Bad Thing', 'desc', 'critical', 'finance', 'apex')`
    ).bind(TENANT).run();
    // 1 active risk (issue).
    await env.DB.prepare(
      `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, status)
       VALUES ('ar1', ?, 'Risky Thing', 'd', 'high', 'operations', 'active')`
    ).bind(TENANT).run();

    const result = await generateApexInsights(env.DB, throwingAi, TENANT);

    // One driver per dimension.
    expect(result.performanceDrivers).toHaveLength(2);
    const fin = result.performanceDrivers.find(d => d.dimension === 'financial')!;
    expect(fin.impact).toBe('Positive contributor'); // score 90 >= 80
    expect(fin.direction).toBe('improving');
    const ops = result.performanceDrivers.find(d => d.dimension === 'operational')!;
    expect(ops.impact).toBe('Negative contributor — dragging overall health down'); // score 45 < 60
    expect(ops.direction).toBe('declining');

    // Issues = critical insight + active risk.
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map(i => i.title)).toEqual(
      expect.arrayContaining(['Bad Thing', 'Risky Thing'])
    );

    // Deterministic fallback executive summary references the score and trends.
    expect(result.executiveSummary).toContain('68/100');
    expect(result.executiveSummary).toContain('financial'); // improving list
    expect(result.executiveSummary).toContain('operational'); // declining list

    // overall 68 → between 60 and 75 → moderate-risk strategic implication.
    expect(result.strategicImplications[0]).toContain('Moderate risk');
  });
});
