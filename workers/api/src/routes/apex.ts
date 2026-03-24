import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { withLlmFallback } from '../services/ollama';

const apex = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// Helper: check if a query/action references a disabled sub-catalyst
async function checkSubCatalystRestriction(db: D1Database, tenantId: string, context: string): Promise<{ restricted: boolean; subName?: string }> {
  try {
    const clusters = await db.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all();
    const ctxLower = context.toLowerCase();
    for (const cl of clusters.results) {
      const subs = JSON.parse((cl as Record<string, unknown>).sub_catalysts as string || '[]') as Array<{ name: string; enabled: boolean }>;
      for (const sub of subs) {
        if (!sub.enabled && ctxLower.includes(sub.name.toLowerCase())) {
          return { restricted: true, subName: sub.name };
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return { restricted: false };
}

// GET /api/apex/health
apex.get('/health', async (c) => {
  const tenantId = getTenantId(c);
  const score = await c.env.DB.prepare(
    'SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  if (!score) {
    return c.json({ overall: 0, dimensions: {}, calculatedAt: null });
  }

  return c.json({
    id: score.id,
    overall: score.overall_score,
    dimensions: JSON.parse(score.dimensions as string || '{}'),
    calculatedAt: score.calculated_at,
  });
});

// A1-3: GET /api/apex/health/history — Health score time-series for trend sparklines
apex.get('/health/history', async (c) => {
  const tenantId = getTenantId(c);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '30', 10) || 30, 1), 90);

  const results = await c.env.DB.prepare(
    'SELECT id, overall_score, dimensions, source_run_id, catalyst_name, recorded_at FROM health_score_history WHERE tenant_id = ? ORDER BY recorded_at DESC LIMIT ?'
  ).bind(tenantId, limit).all();

  const history = results.results.map((h: Record<string, unknown>) => ({
    id: h.id,
    overallScore: h.overall_score,
    dimensions: JSON.parse(h.dimensions as string || '{}'),
    sourceRunId: h.source_run_id || null,
    catalystName: h.catalyst_name || null,
    recordedAt: h.recorded_at,
  }));

  // Calculate delta from latest vs 7-days-ago
  let delta = 0;
  let deltaLabel = 'No change';
  if (history.length >= 2) {
    const latest = history[0].overallScore as number;
    // Find score from ~7 days ago (or oldest available)
    const weekAgo = history.length > 7 ? history[7].overallScore as number : history[history.length - 1].overallScore as number;
    delta = latest - weekAgo;
    deltaLabel = delta > 0 ? `+${delta} points this week` : delta < 0 ? `${delta} points this week` : 'No change this week';
  }

  return c.json({ history: history.reverse(), delta, deltaLabel, total: history.length });
});

// GET /api/apex/briefing
apex.get('/briefing', async (c) => {
  const tenantId = getTenantId(c);
  const briefing = await c.env.DB.prepare(
    'SELECT * FROM executive_briefings WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  if (!briefing) {
    return c.json({ error: 'No briefings found' }, 404);
  }

  return c.json({
    id: briefing.id,
    title: briefing.title,
    summary: briefing.summary,
    risks: JSON.parse(briefing.risks as string || '[]'),
    opportunities: JSON.parse(briefing.opportunities as string || '[]'),
    kpiMovements: JSON.parse(briefing.kpi_movements as string || '[]'),
    decisionsNeeded: JSON.parse(briefing.decisions_needed as string || '[]'),
    generatedAt: briefing.generated_at,
    // A2: Data-driven briefing fields
    healthDelta: briefing.health_delta ?? null,
    redMetricCount: briefing.red_metric_count ?? null,
    anomalyCount: briefing.anomaly_count ?? null,
    activeRiskCount: briefing.active_risk_count ?? null,
  });
});

// GET /api/apex/risks
apex.get('/risks', async (c) => {
  const tenantId = getTenantId(c);
  const severity = c.req.query('severity');

  let query = 'SELECT * FROM risk_alerts WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (severity) {
    query += ' AND severity = ?';
    binds.push(severity);
  }

  query += ' ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END';

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    severity: r.severity,
    category: r.category,
    probability: r.probability,
    impactValue: r.impact_value,
    impactUnit: r.impact_unit || 'ZAR',
    recommendedActions: JSON.parse(r.recommended_actions as string || '[]'),
    status: r.status,
    detectedAt: r.detected_at,
    // P1/A4-3: Source attribution for drill-through
    sourceRunId: r.source_run_id || null,
    clusterId: r.cluster_id || null,
    subCatalystName: r.sub_catalyst_name || null,
  }));

  return c.json({ risks: formatted, total: formatted.length });
});

// POST /api/apex/risks
apex.post('/risks', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    title: string; description: string; severity: string;
    category: string; probability?: number; impact_value?: number; recommended_actions?: string[];
  }>(c, [
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'description', type: 'string', required: true, minLength: 1, maxLength: 2000 },
    { field: 'severity', type: 'string', required: true, minLength: 1, maxLength: 32 },
    { field: 'category', type: 'string', required: true, minLength: 1, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, recommended_actions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.title, body.description, body.severity, body.category, body.probability || 0, body.impact_value || 0, JSON.stringify(body.recommended_actions || [])).run();

  return c.json({ id }, 201);
});

// PUT /api/apex/risks/:id
apex.put('/risks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string }>();

  if (body.status) {
    const resolvedAt = body.status === 'resolved' ? "datetime('now')" : 'NULL';
    await c.env.DB.prepare(
      `UPDATE risk_alerts SET status = ?, resolved_at = ${resolvedAt} WHERE id = ?`
    ).bind(body.status, id).run();
  }

  return c.json({ success: true });
});

// GET /api/apex/scenarios
apex.get('/scenarios', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM scenarios WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  const formatted = results.results.map((s: Record<string, unknown>) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    inputQuery: s.input_query,
    variables: JSON.parse(s.variables as string || '[]'),
    results: JSON.parse(s.results as string || '{}'),
    status: s.status,
    createdAt: s.created_at,
  }));

  return c.json({ scenarios: formatted, total: formatted.length });
});

// POST /api/apex/scenarios
apex.post('/scenarios', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    title: string; description: string; input_query: string; variables?: string[];
  }>(c, [
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'description', type: 'string', required: true, minLength: 1, maxLength: 2000 },
    { field: 'input_query', type: 'string', required: true, minLength: 1, maxLength: 2000 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Check sub-catalyst restrictions — block scenarios referencing disabled sub-catalysts
  const restriction = await checkSubCatalystRestriction(c.env.DB, tenantId, `${body.title} ${body.description} ${body.input_query}`);
  if (restriction.restricted) {
    return c.json({ error: `The sub-catalyst "${restriction.subName}" is currently disabled by your administrator. Enable it before running scenarios that reference it.`, restricted: true, restrictedSubCatalyst: restriction.subName }, 403);
  }

  const id = crypto.randomUUID();

  // A3-1: Gather real context data for scenario analysis
  let contextData: Record<string, unknown> = {};
  try {
    const health = await c.env.DB.prepare('SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ overall_score: number; dimensions: string }>();
    const redMetrics = await c.env.DB.prepare("SELECT name, value, unit FROM process_metrics WHERE tenant_id = ? AND status = 'red' LIMIT 10").bind(tenantId).all();
    const activeRisks = await c.env.DB.prepare("SELECT title, severity, category FROM risk_alerts WHERE tenant_id = ? AND status = 'active' LIMIT 10").bind(tenantId).all();
    const recentRuns = await c.env.DB.prepare('SELECT sub_catalyst_name, status, matched, discrepancies, exceptions_raised FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 20').bind(tenantId).all();
    contextData = {
      healthScore: health?.overall_score ?? 0,
      dimensions: health?.dimensions ? JSON.parse(health.dimensions) : {},
      redMetrics: redMetrics.results || [],
      activeRisks: activeRisks.results || [],
      recentRuns: recentRuns.results || [],
    };
  } catch (err) { console.error('scenarios: context gathering failed:', err); }

  // A3-2 + Spec 7 LLM-2: Scenario modelling with withLlmFallback wrapper
  const healthScore = (contextData.healthScore as number) || 50;
  const redCount = ((contextData.redMetrics as unknown[]) || []).length;
  const riskCount = ((contextData.activeRisks as unknown[]) || []).length;

  const llmResult = await withLlmFallback<Record<string, unknown>>(
    async () => {
      const ai = (c.env as unknown as Record<string, unknown>).AI;
      if (!ai || typeof (ai as Record<string, unknown>).run !== 'function') throw new Error('Workers AI not available');
      const prompt = `You are Atheon Mind, an enterprise AI analyst. Analyze this what-if scenario for a business:\n\nScenario: ${body.title}\nDescription: ${body.description}\nQuery: ${body.input_query}\n\nCurrent Business Context:\n- Health Score: ${healthScore}/100\n- RED Metrics: ${JSON.stringify(contextData.redMetrics || [])}\n- Active Risks: ${JSON.stringify(contextData.activeRisks || [])}\n- Recent Runs: ${JSON.stringify((contextData.recentRuns as unknown[])?.slice(0, 5) || [])}\n\nRespond with JSON: { "npv_impact": number, "risk_change": string, "confidence": number (0-100), "recommendation": string, "analysis_points": string[] }`;
      const aiResult = await (ai as { run: (model: string, input: { prompt: string }) => Promise<{ response?: string }> }).run('@cf/meta/llama-3.1-8b-instruct', { prompt });
      const text = aiResult?.response || '';
      if (!text) throw new Error('Empty AI response');
      try {
        return { ...JSON.parse(text), generated_at: new Date().toISOString(), model: 'llama-3.1-8b-instruct' };
      } catch {
        return { recommendation: text, generated_at: new Date().toISOString(), model: 'llama-3.1-8b-instruct' };
      }
    },
    () => {
      // Data-driven deterministic fallback (no Math.random)
      const baseImpact = healthScore > 70 ? 500000 : healthScore > 50 ? -200000 : -1000000;
      const riskAdjustment = riskCount * -150000 + redCount * -100000;
      return {
        npv_impact: Math.round(baseImpact + riskAdjustment),
        risk_change: `${riskCount > 3 ? '+' : '-'}${Math.round(riskCount * 3 + redCount * 2)}%`,
        confidence: Math.max(40, Math.min(85, 75 - riskCount * 5 - redCount * 3)),
        recommendation: `Based on current health score (${healthScore}/100), ${redCount} RED metric(s), and ${riskCount} active risk(s): ${healthScore > 70 ? 'Organization is well-positioned for this change.' : healthScore > 50 ? 'Moderate risk — address RED metrics before proceeding.' : 'High risk — stabilize operations first.'}`,
        analysis_points: [
          `Current health score: ${healthScore}/100`,
          redCount > 0 ? `${redCount} metric(s) in RED status need attention` : 'All metrics within acceptable ranges',
          riskCount > 0 ? `${riskCount} active risk alert(s) may impact outcome` : 'No active risk alerts',
        ],
        generated_at: new Date().toISOString(),
        model: 'fallback-calculation',
      };
    },
    10000, // 10s timeout
  );
  const scenarioResults = { ...llmResult.result, source: llmResult.source };
  const modelResponse = llmResult.source === 'llm' ? JSON.stringify(llmResult.result) : null;

  await c.env.DB.prepare(
    'INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status, context_data, model_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.title, body.description, body.input_query, JSON.stringify(body.variables || []), JSON.stringify(scenarioResults), 'completed', JSON.stringify(contextData), modelResponse).run();

  return c.json({ id, results: scenarioResults, context: contextData }, 201);
});

export default apex;
