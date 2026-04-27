/**
 * Apex Radar Routes V2
 * External signal processing, competitors, benchmarks, regulatory events,
 * and unified strategic context API.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { analyseSignalImpact, computeStrategicContext, runScheduledRadarScan } from '../services/radar-engine-v2';
import { toCSV, csvResponse } from '../services/csv-export';

const radar = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/radar/signals
radar.get('/signals', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const category = c.req.query('category');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
  let query = 'SELECT * FROM external_signals WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (category) { query += ' AND category = ?'; binds.push(category); }
  query += ' ORDER BY relevance_score DESC, detected_at DESC LIMIT ?';
  binds.push(limit);
  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const signals = results.results.map((s: Record<string, unknown>) => ({
    id: s.id, category: s.category, title: s.title, summary: s.summary,
    sourceUrl: s.source_url, sourceName: s.source_name,
    reliabilityScore: s.reliability_score, relevanceScore: s.relevance_score,
    sentiment: s.sentiment, detectedAt: s.detected_at, expiresAt: s.expires_at,
  }));
  // §9.4 CSV export
  if (c.req.query('format') === 'csv') {
    return csvResponse(toCSV(signals, [
      { key: 'id', label: 'ID' }, { key: 'category', label: 'Category' }, { key: 'title', label: 'Title' },
      { key: 'summary', label: 'Summary' }, { key: 'relevanceScore', label: 'Relevance Score' },
      { key: 'sentiment', label: 'Sentiment' }, { key: 'detectedAt', label: 'Detected At' },
    ]), 'radar-signals.csv');
  }
  return c.json({ signals, total: signals.length });
});

// POST /api/radar/signals
radar.post('/signals', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const { data: body, errors } = await getValidatedJsonBody<{
    category: string; title: string; summary: string;
    source_url?: string; source_name?: string; sentiment?: string;
  }>(c, [
    { field: 'category', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 500 },
    { field: 'summary', type: 'string', required: true, minLength: 1, maxLength: 5000 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO external_signals (id, tenant_id, category, title, summary, source_url, source_name, sentiment, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tenantId, body.category, body.title, body.summary,
    body.source_url || null, body.source_name || null, body.sentiment || 'neutral', now).run();
  try { await analyseSignalImpact(c.env.DB, tenantId, id, c.env); } catch (err) { console.error('Signal impact analysis failed:', err); }

  // §9.5 Audit trail
  try {
    await c.env.DB.prepare(
      "INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), tenantId, 'signal.created', 'radar', id,
      JSON.stringify({ signalId: id, category: body.category, title: body.title }), 'success').run();
  } catch { /* non-fatal */ }

  return c.json({ id, message: 'Signal created and impact analysis triggered' }, 201);
});

// GET /api/radar/signals/:signalId/impact
radar.get('/signals/:signalId/impact', async (c) => {
  const tenantId = getTenantId(c);
  const signalId = c.req.param('signalId');
  const signal = await c.env.DB.prepare('SELECT * FROM external_signals WHERE id = ? AND tenant_id = ?').bind(signalId, tenantId).first();
  if (!signal) return c.json({ error: 'Signal not found' }, 404);
  const impacts = await c.env.DB.prepare('SELECT * FROM signal_impacts WHERE signal_id = ? AND tenant_id = ? ORDER BY impact_magnitude DESC').bind(signalId, tenantId).all();
  return c.json({
    signal: { id: signal.id, category: signal.category, title: signal.title, summary: signal.summary, sourceName: signal.source_name, relevanceScore: signal.relevance_score, sentiment: signal.sentiment },
    impacts: impacts.results.map((i: Record<string, unknown>) => ({
      id: i.id, healthDimension: i.health_dimension, impactMagnitude: i.impact_magnitude,
      impactDirection: i.impact_direction, impactTimeline: i.impact_timeline,
      confidence: i.confidence, recommendedResponse: i.recommended_response, computedAt: i.computed_at,
    })),
  });
});

// GET /api/radar/competitors
radar.get('/competitors', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const results = await c.env.DB.prepare('SELECT * FROM competitors WHERE tenant_id = ? ORDER BY market_share DESC').bind(tenantId).all();
  const competitors = results.results.map((r: Record<string, unknown>) => ({
    id: r.id, name: r.name, industry: r.industry, estimatedRevenue: r.estimated_revenue,
    marketShare: r.market_share, strengths: JSON.parse(r.strengths as string || '[]'),
    weaknesses: JSON.parse(r.weaknesses as string || '[]'), lastUpdated: r.last_updated, signalsCount: r.signals_count,
  }));
  if (c.req.query('format') === 'csv') {
    return csvResponse(toCSV(competitors, [
      { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'industry', label: 'Industry' },
      { key: 'estimatedRevenue', label: 'Est. Revenue' }, { key: 'marketShare', label: 'Market Share %' },
    ]), 'radar-competitors.csv');
  }
  return c.json({ competitors, total: competitors.length });
});

// POST /api/radar/competitors
radar.post('/competitors', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const body = await c.req.json<{ name: string; industry?: string; estimated_revenue?: string; market_share?: number; strengths?: string[]; weaknesses?: string[] }>();
  if (!body.name) return c.json({ error: 'name required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO competitors (id, tenant_id, name, industry, estimated_revenue, market_share, strengths, weaknesses) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.name, body.industry || null, body.estimated_revenue || null, body.market_share || null, JSON.stringify(body.strengths || []), JSON.stringify(body.weaknesses || [])).run();
  return c.json({ id }, 201);
});

// PUT /api/radar/competitors/:id
radar.put('/competitors/:id', async (c) => {
  const tenantId = getTenantId(c);
  const compId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const updates: string[] = [];
  const binds: unknown[] = [];
  if (body.name) { updates.push('name = ?'); binds.push(body.name); }
  if (body.industry !== undefined) { updates.push('industry = ?'); binds.push(body.industry); }
  if (body.estimated_revenue !== undefined) { updates.push('estimated_revenue = ?'); binds.push(body.estimated_revenue); }
  if (body.market_share !== undefined) { updates.push('market_share = ?'); binds.push(body.market_share); }
  if (body.strengths) { updates.push('strengths = ?'); binds.push(JSON.stringify(body.strengths)); }
  if (body.weaknesses) { updates.push('weaknesses = ?'); binds.push(JSON.stringify(body.weaknesses)); }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  updates.push("last_updated = datetime('now')");
  await c.env.DB.prepare(`UPDATE competitors SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds, compId, tenantId).run();
  return c.json({ success: true });
});

// DELETE /api/radar/competitors/:id
radar.delete('/competitors/:id', async (c) => {
  const tenantId = getTenantId(c);
  await c.env.DB.prepare('DELETE FROM competitors WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tenantId).run();
  return c.json({ success: true });
});

// GET /api/radar/benchmarks
radar.get('/benchmarks', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const results = await c.env.DB.prepare('SELECT * FROM market_benchmarks WHERE tenant_id = ? ORDER BY measured_at DESC').bind(tenantId).all();
  const benchmarks = results.results.map((b: Record<string, unknown>) => ({
    id: b.id, industry: b.industry, metricName: b.metric_name, benchmarkValue: b.benchmark_value,
    benchmarkUnit: b.benchmark_unit, percentile25: b.percentile_25, percentile50: b.percentile_50,
    percentile75: b.percentile_75, source: b.source, measuredAt: b.measured_at,
  }));
  if (c.req.query('format') === 'csv') {
    return csvResponse(toCSV(benchmarks, [
      { key: 'id', label: 'ID' }, { key: 'industry', label: 'Industry' }, { key: 'metricName', label: 'Metric' },
      { key: 'benchmarkValue', label: 'Value' }, { key: 'benchmarkUnit', label: 'Unit' },
      { key: 'percentile50', label: 'P50' }, { key: 'source', label: 'Source' },
    ]), 'radar-benchmarks.csv');
  }
  return c.json({ benchmarks, total: benchmarks.length });
});

// POST /api/radar/benchmarks
radar.post('/benchmarks', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const body = await c.req.json<{ industry: string; metric_name: string; benchmark_value: number; benchmark_unit?: string; percentile_25?: number; percentile_50?: number; percentile_75?: number; source?: string }>();
  if (!body.industry || !body.metric_name) return c.json({ error: 'industry and metric_name required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO market_benchmarks (id, tenant_id, industry, metric_name, benchmark_value, benchmark_unit, percentile_25, percentile_50, percentile_75, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.industry, body.metric_name, body.benchmark_value || 0, body.benchmark_unit || null, body.percentile_25 || null, body.percentile_50 || null, body.percentile_75 || null, body.source || null).run();
  return c.json({ id }, 201);
});

// GET /api/radar/regulatory
radar.get('/regulatory', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const status = c.req.query('status');
  let query = 'SELECT * FROM regulatory_events WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  query += ' ORDER BY compliance_deadline ASC';
  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const events = results.results.map((e: Record<string, unknown>) => ({
    id: e.id, title: e.title, description: e.description, jurisdiction: e.jurisdiction,
    affectedDimensions: JSON.parse(e.affected_dimensions as string || '[]'),
    effectiveDate: e.effective_date, complianceDeadline: e.compliance_deadline,
    readinessScore: e.readiness_score, status: e.status, sourceUrl: e.source_url,
  }));
  if (c.req.query('format') === 'csv') {
    return csvResponse(toCSV(events, [
      { key: 'id', label: 'ID' }, { key: 'title', label: 'Title' }, { key: 'jurisdiction', label: 'Jurisdiction' },
      { key: 'status', label: 'Status' }, { key: 'complianceDeadline', label: 'Deadline' },
      { key: 'readinessScore', label: 'Readiness %' },
    ]), 'radar-regulatory.csv');
  }
  return c.json({ events, total: events.length });
});

// POST /api/radar/regulatory
radar.post('/regulatory', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const body = await c.req.json<{ title: string; description: string; jurisdiction?: string; affected_dimensions?: string[]; effective_date?: string; compliance_deadline?: string; source_url?: string }>();
  if (!body.title || !body.description) return c.json({ error: 'title and description required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO regulatory_events (id, tenant_id, title, description, jurisdiction, affected_dimensions, effective_date, compliance_deadline, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.title, body.description, body.jurisdiction || 'South Africa', JSON.stringify(body.affected_dimensions || []), body.effective_date || null, body.compliance_deadline || null, body.source_url || null).run();
  return c.json({ id }, 201);
});

// GET /api/radar/context — V1-compatible response wrapper around V2 engine
radar.get('/context', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  try {
    const v2 = await computeStrategicContext(c.env.DB, tenantId, c.env) as Record<string, unknown>;
    const headwinds = (v2.headwinds as Array<Record<string, unknown>>) || [];
    const tailwinds = (v2.tailwinds as Array<Record<string, unknown>>) || [];
    const topSignals = (v2.topSignals as Array<Record<string, unknown>>) || [];
    const allImpacts = [...headwinds, ...tailwinds];
    const criticalImpacts = allImpacts.filter(i => (i.impactMagnitude as number) >= 8).length;
    const overallSentiment = tailwinds.length > headwinds.length ? 'positive' : headwinds.length > tailwinds.length ? 'negative' : 'neutral';

    // Build V1-compatible signals array from topSignals
    const signals = topSignals.map(s => ({
      id: s.id, category: s.category, title: s.title, summary: s.summary,
      sourceUrl: null, sourceName: null, reliabilityScore: null,
      relevanceScore: s.relevanceScore, sentiment: null,
      detectedAt: null, expiresAt: null,
    }));

    // Build V1-compatible impacts array
    const impacts = allImpacts.map(i => ({
      id: i.id, signalId: i.signalId, signalTitle: i.signalTitle,
      dimension: i.healthDimension, impactDirection: i.impactDirection,
      impactMagnitude: i.impactMagnitude,
      affectedMetrics: [], recommendedActions: [],
      llmReasoning: i.recommendedResponse, createdAt: i.computedAt,
    }));

    return c.json({
      context: v2.contextNarrative ? {
        id: 'ctx-' + tenantId,
        contextType: 'strategic',
        title: 'Strategic Context',
        summary: v2.contextNarrative as string,
        factors: [],
        sentiment: overallSentiment,
        confidence: Math.min(100, (topSignals.length + allImpacts.length) * 10),
        sourceSignalIds: topSignals.map(s => s.id),
        validFrom: new Date().toISOString(),
        validTo: null,
        createdAt: new Date().toISOString(),
      } : null,
      signals,
      impacts,
      summary: {
        totalSignals: topSignals.length,
        activeSignals: topSignals.length,
        criticalImpacts,
        overallSentiment,
      },
      // V2 fields pass-through
      healthScore: v2.healthScore,
      industryBenchmark: v2.industryBenchmark,
      headwinds,
      tailwinds,
      competitorCount: v2.competitorCount,
      regulatoryDeadlines: v2.regulatoryDeadlines,
    });
  } catch (err) {
    return c.json({ error: 'Failed to compute strategic context', detail: (err as Error).message }, 500);
  }
});

// §11.4 GET /api/radar/peer-benchmarks — Anonymised industry peer benchmarks
radar.get('/peer-benchmarks', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  // Industry no longer tracked on tenants — fall back to 'general' benchmarks.
  // Per-tenant industry tagging can be reintroduced via tenant_tags if needed.
  const industry = 'general';

  // Get anonymised benchmarks for this industry (only if >= 3 tenants contribute)
  const benchmarks = await c.env.DB.prepare(
    'SELECT dimension, period, tenant_count, avg_score, p25_score, p50_score, p75_score, min_score, max_score, calculated_at FROM anonymised_benchmarks WHERE industry = ? AND tenant_count >= 3 ORDER BY dimension ASC'
  ).bind(industry).all();

  // Get tenant's own scores for comparison
  const health = await c.env.DB.prepare(
    'SELECT dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();
  const dims = health?.dimensions ? JSON.parse(health.dimensions as string) : {};

  const peerData = benchmarks.results.map((b: Record<string, unknown>) => {
    const dimension = b.dimension as string;
    const ownScore = dims[dimension]?.score || null;
    return {
      dimension,
      period: b.period,
      tenantCount: b.tenant_count,
      avgScore: b.avg_score,
      p25Score: b.p25_score,
      p50Score: b.p50_score,
      p75Score: b.p75_score,
      minScore: b.min_score,
      maxScore: b.max_score,
      ownScore,
      percentileRank: ownScore !== null && (b.tenant_count as number) > 0
        ? ownScore >= (b.p75_score as number) ? 'top_25'
          : ownScore >= (b.p50_score as number) ? 'above_median'
          : ownScore >= (b.p25_score as number) ? 'below_median'
          : 'bottom_25'
        : null,
      calculatedAt: b.calculated_at,
    };
  });

  return c.json({ industry, benchmarks: peerData, total: peerData.length });
});

// §11.6 GET /api/radar/success-stories — Anonymised peer insights from resolved RCAs
radar.get('/success-stories', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  // Industry segmentation is intentionally global on this endpoint — patterns
  // are aggregated across all tenants under the 'general' bucket. Per-tenant
  // industry is captured on tenants.industry (populated from trial signup) but
  // the aggregator (services/scheduled.ts::calculatePeerBenchmarks) currently
  // writes a single 'general' bucket; reading any other value here would miss
  // every row.
  const industry = 'general';

  // Only show resolution patterns with >= 3 resolutions (anonymity threshold)
  const patterns = await c.env.DB.prepare(
    'SELECT pattern_signature, resolution_count, avg_resolution_days, avg_value_recovered, common_fix_types, last_updated FROM resolution_patterns WHERE industry = ? AND resolution_count >= 3 ORDER BY resolution_count DESC LIMIT 20'
  ).bind(industry).all();

  const stories = patterns.results.map((p: Record<string, unknown>) => ({
    patternSignature: p.pattern_signature,
    resolutionCount: p.resolution_count,
    avgResolutionDays: p.avg_resolution_days,
    avgValueRecovered: p.avg_value_recovered,
    commonFixTypes: JSON.parse((p.common_fix_types as string) || '[]'),
    lastUpdated: p.last_updated,
  }));

  return c.json({ industry, stories, total: stories.length });
});

// POST /api/radar/scan
radar.post('/scan', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  try {
    await runScheduledRadarScan(c.env.DB, tenantId, c.env);
    return c.json({ message: 'Radar scan complete' }, 201);
  } catch (err) {
    return c.json({ error: 'Radar scan failed', detail: (err as Error).message }, 500);
  }
});

export default radar;
