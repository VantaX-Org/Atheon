/**
 * Apex Radar Engine V2 — unit coverage with INDEPENDENT oracles.
 *
 * The three exported functions all take `env: { AI }` as a parameter, so we
 * pass a fake AI whose `run()` returns exactly the text we want. That makes the
 * LLM output deterministic without any module mocking — every expected value
 * below is hand-computed from the seeded rows, not read back from the source.
 *
 * Covers: analyseSignalImpact, computeStrategicContext, runScheduledRadarScan.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  analyseSignalImpact,
  computeStrategicContext,
  runScheduledRadarScan,
} from '../services/radar-engine-v2';

const SETUP_SECRET = 'test-setup-secret-for-testing123';

// Fake AI binding: run() resolves { response: <text> } — the shape callWorkersAI reads.
function aiReturning(text: string): { AI: Ai } {
  return { AI: { run: async () => ({ response: text }) } as unknown as Ai };
}
function aiThrowing(): { AI: Ai } {
  return { AI: { run: async () => { throw new Error('AI down'); } } as unknown as Ai };
}

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

async function seedSignal(
  tenantId: string, id: string,
  opts: { title?: string; category?: string; summary?: string; relevance?: number; detectedAtSql?: string } = {},
): Promise<void> {
  const detected = opts.detectedAtSql ?? "datetime('now')";
  await env.DB.prepare(
    `INSERT OR REPLACE INTO external_signals (id, tenant_id, category, title, summary, relevance_score, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ${detected})`
  ).bind(
    id, tenantId, opts.category ?? 'macro', opts.title ?? 'Signal', opts.summary ?? 'summary',
    opts.relevance ?? 0.5,
  ).run();
}

async function impactsFor(signalId: string): Promise<Array<Record<string, unknown>>> {
  const r = await env.DB.prepare(
    'SELECT * FROM signal_impacts WHERE signal_id = ? ORDER BY computed_at, health_dimension'
  ).bind(signalId).all();
  return r.results as Array<Record<string, unknown>>;
}

async function relevanceOf(signalId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT relevance_score FROM external_signals WHERE id = ?')
    .bind(signalId).first<{ relevance_score: number }>();
  return r!.relevance_score;
}

async function notifCount(tenantId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE tenant_id = ?')
    .bind(tenantId).first<{ n: number }>();
  return r!.n;
}

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  expect(res.status).toBeLessThan(500);
});

// ─────────────────────────────────────────────────────────────────────────
describe('analyseSignalImpact', () => {
  const T = 'radar-analyse-t';

  beforeAll(() => seedTenant(T));
  beforeEach(async () => {
    for (const tbl of ['signal_impacts', 'external_signals', 'notifications', 'health_scores']) {
      await env.DB.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).bind(T).run();
    }
  });

  it('writes one row per impact with mapped direction/timeline/response; sets relevance = maxMag/10; no notification below 8', async () => {
    await seedSignal(T, 'sig-A');
    const llm = JSON.stringify({ impacts: [
      { dimension: 'cost', magnitude: 4, direction: 'tailwind', timeline: 'immediate', response: 'cut costs' },
      { dimension: 'growth', magnitude: 6, direction: 'sideways', timeline: 'strategic', response: 'expand' },
    ] });

    await analyseSignalImpact(env.DB, T, 'sig-A', aiReturning(llm));

    const rows = await impactsFor('sig-A');
    expect(rows.length).toBe(2);
    const byDim = Object.fromEntries(rows.map(r => [r.health_dimension as string, r]));

    // cost: direction 'tailwind' passes through
    expect(byDim.cost.impact_magnitude).toBe(4);
    expect(byDim.cost.impact_direction).toBe('tailwind');
    expect(byDim.cost.impact_timeline).toBe('immediate');
    expect(byDim.cost.recommended_response).toBe('cut costs');
    expect(byDim.cost.confidence).toBe(0.7);
    // analysis column round-trips the raw impact object
    expect(JSON.parse(byDim.cost.analysis as string).response).toBe('cut costs');

    // growth: direction 'sideways' !== 'tailwind' → coerced to 'headwind'
    expect(byDim.growth.impact_magnitude).toBe(6);
    expect(byDim.growth.impact_direction).toBe('headwind');

    // maxMag = 6 → relevance 0.6
    expect(await relevanceOf('sig-A')).toBeCloseTo(0.6, 10);
    expect(await notifCount(T)).toBe(0);
  });

  it('clamps magnitude to 1..10, defaults missing fields, and fires a critical notification when maxMag >= 8', async () => {
    await seedSignal(T, 'sig-B', { title: 'Rate shock', category: 'macro' });
    // 15 → 10 ; -3 → max(1,-3)=1 ; 0 → (0||5)=5.  Missing dir/timeline/response → defaults.
    const llm = JSON.stringify({ impacts: [
      { dimension: 'a', magnitude: 15 },
      { dimension: 'b', magnitude: -3 },
      { dimension: 'c', magnitude: 0 },
    ] });

    await analyseSignalImpact(env.DB, T, 'sig-B', aiReturning(llm));

    const rows = await impactsFor('sig-B');
    const mags = Object.fromEntries(rows.map(r => [r.health_dimension, r.impact_magnitude]));
    expect(mags).toEqual({ a: 10, b: 1, c: 5 });
    // defaults
    expect(rows[0].impact_direction).toBe('headwind');
    expect(rows[0].impact_timeline).toBe('near-term');
    expect(rows[0].recommended_response).toBeNull();
    // maxMag = 10 → relevance 1.0
    expect(await relevanceOf('sig-B')).toBeCloseTo(1.0, 10);

    // critical notification created
    expect(await notifCount(T)).toBe(1);
    const notif = await env.DB.prepare('SELECT * FROM notifications WHERE tenant_id = ?').bind(T)
      .first<Record<string, unknown>>();
    expect(notif!.severity).toBe('critical');
    expect(notif!.type).toBe('alert');
    expect(notif!.title).toContain('Rate shock');
    expect(notif!.message).toContain('magnitude 10/10');
    expect(notif!.message).toContain('a, b, c');
  });

  it('notifies at exactly magnitude 8 (boundary) but not at 7', async () => {
    await seedSignal(T, 'sig-8');
    await analyseSignalImpact(env.DB, T, 'sig-8',
      aiReturning(JSON.stringify({ impacts: [{ dimension: 'x', magnitude: 8 }] })));
    expect(await notifCount(T)).toBe(1);
    expect(await relevanceOf('sig-8')).toBeCloseTo(0.8, 10);

    await env.DB.prepare('DELETE FROM notifications WHERE tenant_id = ?').bind(T).run();

    await seedSignal(T, 'sig-7');
    await analyseSignalImpact(env.DB, T, 'sig-7',
      aiReturning(JSON.stringify({ impacts: [{ dimension: 'y', magnitude: 7 }] })));
    expect(await notifCount(T)).toBe(0);
    expect(await relevanceOf('sig-7')).toBeCloseTo(0.7, 10);
  });

  it('falls back to a single strategic/headwind/5 impact when the LLM returns non-JSON', async () => {
    await seedSignal(T, 'sig-bad');
    await analyseSignalImpact(env.DB, T, 'sig-bad', aiReturning('sorry, I cannot do that'));

    const rows = await impactsFor('sig-bad');
    expect(rows.length).toBe(1);
    expect(rows[0].health_dimension).toBe('strategic');
    expect(rows[0].impact_magnitude).toBe(5);
    expect(rows[0].impact_direction).toBe('headwind');
    expect(rows[0].impact_timeline).toBe('near-term');
    expect(rows[0].recommended_response).toBe('Review signal and assess impact manually');
    expect(await relevanceOf('sig-bad')).toBeCloseTo(0.5, 10);
    expect(await notifCount(T)).toBe(0);
  });

  it('accepts a bare-array LLM response (parsed is an Array)', async () => {
    await seedSignal(T, 'sig-arr');
    await analyseSignalImpact(env.DB, T, 'sig-arr',
      aiReturning(JSON.stringify([{ dimension: 'z', magnitude: 3, direction: 'tailwind' }])));
    const rows = await impactsFor('sig-arr');
    expect(rows.length).toBe(1);
    expect(rows[0].impact_magnitude).toBe(3);
    expect(rows[0].impact_direction).toBe('tailwind');
    expect(await relevanceOf('sig-arr')).toBeCloseTo(0.3, 10);
  });

  it('empty impacts array writes no rows and drives relevance to 0', async () => {
    await seedSignal(T, 'sig-empty', { relevance: 0.5 });
    await analyseSignalImpact(env.DB, T, 'sig-empty',
      aiReturning(JSON.stringify({ impacts: [] })));
    expect((await impactsFor('sig-empty')).length).toBe(0);
    expect(await relevanceOf('sig-empty')).toBe(0); // maxMag 0 → 0/10
  });

  it('throws when the signal does not exist', async () => {
    await expect(
      analyseSignalImpact(env.DB, T, 'no-such-signal', aiReturning('{}'))
    ).rejects.toThrow('Signal not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('computeStrategicContext', () => {
  const T = 'radar-ctx-t';

  beforeAll(() => seedTenant(T));
  beforeEach(async () => {
    for (const tbl of ['signal_impacts', 'external_signals', 'health_scores',
      'competitors', 'regulatory_events', 'market_benchmarks', 'notifications']) {
      await env.DB.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).bind(T).run();
    }
  });

  async function seedImpact(
    signalId: string, dimension: string, magnitude: number, direction: 'headwind' | 'tailwind',
  ): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO signal_impacts (id, signal_id, tenant_id, health_dimension, impact_magnitude, impact_direction, confidence)
       VALUES (?, ?, ?, ?, ?, ?, 0.7)`
    ).bind(crypto.randomUUID(), signalId, T, dimension, magnitude, direction).run();
  }
  async function seedBenchmark(value: number, unit: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO market_benchmarks (id, tenant_id, industry, metric_name, benchmark_value, benchmark_unit)
       VALUES (?, ?, 'general', 'health', ?, ?)`
    ).bind(crypto.randomUUID(), T, value, unit).run();
  }
  async function seedReg(title: string, deadlineSql: string, status: string, readiness: number): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO regulatory_events (id, tenant_id, title, description, compliance_deadline, status, readiness_score)
       VALUES (?, ?, ?, 'desc', ${deadlineSql}, ?, ?)`
    ).bind(crypto.randomUUID(), T, title, status, readiness).run();
  }

  it('aggregates health, ordered head/tailwinds, competitor count, filtered reg deadlines, top signals, and benchmark average', async () => {
    await env.DB.prepare(
      `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions) VALUES (?, ?, 72, '{}')`
    ).bind(crypto.randomUUID(), T).run();

    await seedSignal(T, 'ctx-s1', { title: 'Rand crash', category: 'fx', relevance: 0.9 });
    await seedSignal(T, 'ctx-s2', { title: 'Oil up', category: 'commodity', relevance: 0.5 });

    // headwinds mags 9,6,3 → expect order [9,6,3]; tailwinds 8,2 → [8,2]
    await seedImpact('ctx-s1', 'cost', 9, 'headwind');
    await seedImpact('ctx-s2', 'supply', 6, 'headwind');
    await seedImpact('ctx-s1', 'ops', 3, 'headwind');
    await seedImpact('ctx-s2', 'demand', 8, 'tailwind');
    await seedImpact('ctx-s1', 'brand', 2, 'tailwind');

    await env.DB.prepare(`INSERT INTO competitors (id, tenant_id, name) VALUES (?, ?, 'Rival A')`)
      .bind(crypto.randomUUID(), T).run();
    await env.DB.prepare(`INSERT INTO competitors (id, tenant_id, name) VALUES (?, ?, 'Rival B')`)
      .bind(crypto.randomUUID(), T).run();

    // reg: only the +30d upcoming with a deadline should survive the <90d window
    await seedReg('POPIA', "datetime('now','+30 days')", 'upcoming', 0.4);   // included
    await seedReg('FarOff', "datetime('now','+200 days')", 'upcoming', 0.1); // excluded: >90d
    await seedReg('Done', "datetime('now','+10 days')", 'complete', 0.9);    // excluded: status
    await seedReg('NoDate', 'NULL', 'upcoming', 0.2);                        // excluded: null deadline

    // benchmarks: only '/100' rows counted; avg(70,80,91)=80.33 → round 80
    await seedBenchmark(70, '/100');
    await seedBenchmark(80, '/100');
    await seedBenchmark(91, '/100');
    await seedBenchmark(999, '%'); // excluded by unit filter

    const ctx = await computeStrategicContext(env.DB, T, aiReturning('  Strategic context summary.  '));

    expect(ctx.healthScore).toBe(72);
    expect(ctx.industryBenchmark).toBe(80);

    const headwinds = ctx.headwinds as Array<Record<string, unknown>>;
    expect(headwinds.map(h => h.impactMagnitude)).toEqual([9, 6, 3]);
    expect(headwinds[0].signalTitle).toBe('Rand crash');
    expect(headwinds[0].category).toBe('fx');

    const tailwinds = ctx.tailwinds as Array<Record<string, unknown>>;
    expect(tailwinds.map(t => t.impactMagnitude)).toEqual([8, 2]);

    expect(ctx.competitorCount).toBe(2);

    const regs = ctx.regulatoryDeadlines as Array<Record<string, unknown>>;
    expect(regs.length).toBe(1);
    expect(regs[0].title).toBe('POPIA');
    expect(regs[0].readinessScore).toBe(0.4);

    const top = ctx.topSignals as Array<Record<string, unknown>>;
    expect(top.length).toBe(2);
    expect(top[0].title).toBe('Rand crash'); // relevance 0.9 first
    expect(top[0].relevanceScore).toBe(0.9);

    // narrative comes straight from the AI text, trimmed
    expect(ctx.contextNarrative).toBe('Strategic context summary.');
  });

  it('industryBenchmark is null when there are no /100 benchmarks', async () => {
    await seedBenchmark(50, '%');
    const ctx = await computeStrategicContext(env.DB, T, aiReturning('x'));
    expect(ctx.industryBenchmark).toBeNull();
  });

  it('uses the deterministic fallback narrative when the AI call throws', async () => {
    await env.DB.prepare(
      `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions) VALUES (?, ?, 72, '{}')`
    ).bind(crypto.randomUUID(), T).run();
    await seedSignal(T, 'ctx-f1');
    await seedImpact('ctx-f1', 'cost', 5, 'headwind');
    await seedImpact('ctx-f1', 'ops', 4, 'headwind');
    await seedImpact('ctx-f1', 'demand', 3, 'tailwind');

    const ctx = await computeStrategicContext(env.DB, T, aiThrowing());
    expect(ctx.contextNarrative).toBe(
      'Business health at 72/100 with 2 headwinds and 1 tailwinds requiring attention.'
    );
  });

  it('defaults healthScore to 0 and empty collections on a bare tenant', async () => {
    const ctx = await computeStrategicContext(env.DB, T, aiReturning('n/a'));
    expect(ctx.healthScore).toBe(0);
    expect(ctx.competitorCount).toBe(0);
    expect((ctx.headwinds as unknown[]).length).toBe(0);
    expect((ctx.tailwinds as unknown[]).length).toBe(0);
    expect(ctx.industryBenchmark).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('runScheduledRadarScan', () => {
  const T = 'radar-scan-t';

  beforeAll(() => seedTenant(T));
  beforeEach(async () => {
    for (const tbl of ['signal_impacts', 'external_signals', 'notifications']) {
      await env.DB.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).bind(T).run();
    }
  });

  it('analyses only fresh (<1 day) signals that have no impacts; skips old and already-analysed ones', async () => {
    await seedSignal(T, 'scan-fresh1', { relevance: 0.5 });
    await seedSignal(T, 'scan-fresh2', { relevance: 0.5 });
    await seedSignal(T, 'scan-old', { relevance: 0.5, detectedAtSql: "datetime('now','-2 days')" });
    await seedSignal(T, 'scan-done', { relevance: 0.5 });
    // scan-done already has an impact → excluded by the LEFT JOIN ... IS NULL
    await env.DB.prepare(
      `INSERT INTO signal_impacts (id, signal_id, tenant_id, health_dimension, impact_magnitude, impact_direction, confidence)
       VALUES (?, 'scan-done', ?, 'pre', 9, 'headwind', 0.7)`
    ).bind(crypto.randomUUID(), T).run();

    await runScheduledRadarScan(env.DB, T, aiReturning(JSON.stringify({ impacts: [{ dimension: 'd', magnitude: 5 }] })));

    // fresh ones each get exactly one new impact
    expect((await impactsFor('scan-fresh1')).length).toBe(1);
    expect((await impactsFor('scan-fresh2')).length).toBe(1);
    expect(await relevanceOf('scan-fresh1')).toBeCloseTo(0.5, 10);
    // old signal untouched
    expect((await impactsFor('scan-old')).length).toBe(0);
    expect(await relevanceOf('scan-old')).toBeCloseTo(0.5, 10);
    // already-analysed signal keeps its single pre-existing impact (not re-analysed)
    const done = await impactsFor('scan-done');
    expect(done.length).toBe(1);
    expect(done[0].health_dimension).toBe('pre');
  });

  it('survives a signal whose analysis throws (AI down) without aborting the scan', async () => {
    await seedSignal(T, 'scan-err');
    await expect(runScheduledRadarScan(env.DB, T, aiThrowing())).resolves.toBeUndefined();
    expect((await impactsFor('scan-err')).length).toBe(0);
  });
});
