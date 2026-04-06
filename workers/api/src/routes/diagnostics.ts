/**
 * Pulse Diagnostics Routes V2
 * Root-cause analysis API using V2 schema tables.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { runRootCauseAnalysis } from '../services/diagnostics-engine-v2';
import { toCSV, csvResponse } from '../services/csv-export';

const diagnostics = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/diagnostics/ — List RCAs
diagnostics.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
  let query = 'SELECT * FROM root_cause_analyses WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  query += ' ORDER BY generated_at DESC LIMIT ?';
  binds.push(limit);
  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const analyses = results.results.map((a: Record<string, unknown>) => ({
    id: a.id, metricId: a.metric_id, metricName: a.metric_name,
    triggerStatus: a.trigger_status, causalChain: JSON.parse(a.causal_chain as string || '[]'),
    confidence: a.confidence, impactSummary: a.impact_summary,
    status: a.status, generatedAt: a.generated_at, resolvedAt: a.resolved_at,
  }));
  if (c.req.query('format') === 'csv') {
    return csvResponse(toCSV(analyses.map(a => ({ ...a, causalChain: JSON.stringify(a.causalChain) })), [
      { key: 'id', label: 'ID' }, { key: 'metricName', label: 'Metric' }, { key: 'triggerStatus', label: 'Severity' },
      { key: 'confidence', label: 'Confidence' }, { key: 'status', label: 'Status' }, { key: 'generatedAt', label: 'Generated At' },
    ]), 'diagnostics-analyses.csv');
  }
  return c.json({ analyses, total: analyses.length });
});

// GET /api/diagnostics/summary — Spec §2.2 (registered before /:metricId to avoid catch-all)
diagnostics.get('/summary', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const [active, pendingRx, completedRx, impactAgg, bySev, undiagnosed] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'pending'").bind(tenantId).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'completed'").bind(tenantId).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(impact_value), 0) as total FROM causal_factors WHERE tenant_id = ? AND impact_value IS NOT NULL").bind(tenantId).first<{ total: number }>(),
    c.env.DB.prepare("SELECT trigger_status, COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'active' GROUP BY trigger_status").bind(tenantId).all(),
    c.env.DB.prepare(`SELECT COUNT(DISTINCT pm.id) as cnt FROM process_metrics pm
      WHERE pm.tenant_id = ? AND pm.status IN ('red', 'amber')
      AND NOT EXISTS (SELECT 1 FROM root_cause_analyses rca WHERE rca.tenant_id = pm.tenant_id AND rca.metric_id = pm.id AND rca.status = 'active')`).bind(tenantId).first<{ cnt: number }>(),
  ]);

  const severity: Record<string, number> = {};
  for (const row of (bySev?.results || [])) {
    const r = row as Record<string, unknown>;
    severity[r.trigger_status as string] = r.cnt as number;
  }

  return c.json({
    totalActive: active?.cnt || 0,
    bySeverity: severity,
    prescriptionsPending: pendingRx?.cnt || 0,
    prescriptionsCompleted: completedRx?.cnt || 0,
    totalImpactValue: impactAgg?.total || 0,
    undiagnosedMetrics: undiagnosed?.cnt || 0,
    totalAnalyses: (active?.cnt || 0) + (completedRx?.cnt || 0),
    pendingAnalyses: active?.cnt || 0,
    completedAnalyses: completedRx?.cnt || 0,
    criticalFindings: severity['red'] || severity['critical'] || 0,
    activeFixes: pendingRx?.cnt || 0,
  });
});

// GET /api/diagnostics/rca/:rcaId/chain — Full causal chain (registered before /:metricId)
diagnostics.get('/rca/:rcaId/chain', async (c) => {
  const tenantId = getTenantId(c);
  const rcaId = c.req.param('rcaId');
  const rca = await c.env.DB.prepare('SELECT * FROM root_cause_analyses WHERE id = ? AND tenant_id = ?').bind(rcaId, tenantId).first();
  if (!rca) return c.json({ error: 'RCA not found' }, 404);
  const factors = await c.env.DB.prepare(
    'SELECT * FROM causal_factors WHERE rca_id = ? AND tenant_id = ? ORDER BY layer ASC, created_at ASC'
  ).bind(rcaId, tenantId).all();
  return c.json({
    rca: { id: rca.id, metricId: rca.metric_id, metricName: rca.metric_name, triggerStatus: rca.trigger_status, confidence: rca.confidence, status: rca.status },
    factors: factors.results.map((f: Record<string, unknown>) => ({
      id: f.id, layer: f.layer, factorType: f.factor_type, title: f.title, description: f.description,
      evidence: JSON.parse(f.evidence as string || '{}'), impactValue: f.impact_value, impactUnit: f.impact_unit,
      confidence: f.confidence, sourceRunIds: JSON.parse(f.source_run_ids as string || '[]'),
      sourceMetricIds: JSON.parse(f.source_metric_ids as string || '[]'), createdAt: f.created_at,
    })),
  });
});

// GET /api/diagnostics/rca/:rcaId/prescriptions
diagnostics.get('/rca/:rcaId/prescriptions', async (c) => {
  const tenantId = getTenantId(c);
  const rcaId = c.req.param('rcaId');
  const results = await c.env.DB.prepare(
    'SELECT * FROM diagnostic_prescriptions WHERE rca_id = ? AND tenant_id = ? ORDER BY CASE priority WHEN \'immediate\' THEN 1 WHEN \'short-term\' THEN 2 ELSE 3 END'
  ).bind(rcaId, tenantId).all();
  const prescriptions = results.results.map((p: Record<string, unknown>) => ({
    id: p.id, rcaId: p.rca_id, priority: p.priority, title: p.title, description: p.description,
    expectedImpact: p.expected_impact, effortLevel: p.effort_level,
    responsibleDomain: p.responsible_domain, deadlineSuggested: p.deadline_suggested,
    status: p.status, createdAt: p.created_at, completedAt: p.completed_at,
  }));
  return c.json({ prescriptions, total: prescriptions.length });
});

// PUT /api/diagnostics/prescriptions/:id/status
diagnostics.put('/prescriptions/:id/status', async (c) => {
  const tenantId = getTenantId(c);
  const prescriptionId = c.req.param('id');
  const body = await c.req.json<{ status: string }>();
  const validStatuses = ['pending', 'in_progress', 'completed', 'rejected'];
  if (!body.status || !validStatuses.includes(body.status)) return c.json({ error: 'Invalid status' }, 400);
  const updates = ['status = ?'];
  const binds: unknown[] = [body.status];
  if (body.status === 'completed') { updates.push("completed_at = datetime('now')"); }
  await c.env.DB.prepare(
    `UPDATE diagnostic_prescriptions SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...binds, prescriptionId, tenantId).run();

  // §9.5 Audit trail
  try {
    await c.env.DB.prepare(
      "INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), tenantId, 'prescription.status_updated', 'diagnostics', prescriptionId,
      JSON.stringify({ prescriptionId, newStatus: body.status }), 'success').run();
  } catch { /* non-fatal */ }

  return c.json({ success: true });
});

// POST /api/diagnostics/:metricId/analyse — Run RCA on metric
diagnostics.post('/:metricId/analyse', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const metricId = c.req.param('metricId');
  try {
    const result = await runRootCauseAnalysis(c.env.DB, tenantId, metricId, c.env);

    // §9.5 Audit trail
    try {
      await c.env.DB.prepare(
        "INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), tenantId, 'rca.generated', 'diagnostics', metricId,
        JSON.stringify({ metricId }), 'success').run();
    } catch { /* non-fatal */ }

    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: 'Diagnostic analysis failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/diagnostics/:metricId — RCAs for a specific metric (MUST be LAST among GET routes)
diagnostics.get('/:metricId', async (c) => {
  const tenantId = getTenantId(c);
  const metricId = c.req.param('metricId');
  const results = await c.env.DB.prepare(
    'SELECT * FROM root_cause_analyses WHERE tenant_id = ? AND metric_id = ? ORDER BY generated_at DESC'
  ).bind(tenantId, metricId).all();
  const analyses = results.results.map((a: Record<string, unknown>) => ({
    id: a.id, metricId: a.metric_id, metricName: a.metric_name,
    triggerStatus: a.trigger_status, causalChain: JSON.parse(a.causal_chain as string || '[]'),
    confidence: a.confidence, impactSummary: a.impact_summary,
    status: a.status, generatedAt: a.generated_at,
  }));
  return c.json({ analyses, total: analyses.length });
});

export default diagnostics;
