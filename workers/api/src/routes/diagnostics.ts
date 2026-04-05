/**
 * Pulse Diagnostics Routes V2
 * Root-cause analysis API using V2 schema tables.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { runRootCauseAnalysis } from '../services/diagnostics-engine-v2';

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
  return c.json({ analyses, total: analyses.length });
});

// GET /api/diagnostics/:metricId — RCAs for a specific metric
diagnostics.get('/:metricId', async (c) => {
  const tenantId = getTenantId(c);
  const metricId = c.req.param('metricId');
  // Avoid matching special paths
  if (metricId === 'summary' || metricId === 'prescriptions') return c.notFound();
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

// POST /api/diagnostics/:metricId/analyse — Run RCA on metric
diagnostics.post('/:metricId/analyse', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const metricId = c.req.param('metricId');
  try {
    const result = await runRootCauseAnalysis(c.env.DB, tenantId, metricId, c.env);
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: 'Diagnostic analysis failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/diagnostics/rca/:rcaId/chain — Full causal chain
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
  return c.json({ success: true });
});

// GET /api/diagnostics/summary
diagnostics.get('/summary', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const active = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ cnt: number }>();
  const resolved = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'resolved'").bind(tenantId).first<{ cnt: number }>();
  const pendingRx = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'pending'").bind(tenantId).first<{ cnt: number }>();
  const completedRx = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'completed'").bind(tenantId).first<{ cnt: number }>();
  return c.json({
    activeRCAs: active?.cnt || 0, resolvedRCAs: resolved?.cnt || 0,
    pendingPrescriptions: pendingRx?.cnt || 0, completedPrescriptions: completedRx?.cnt || 0,
  });
});

export default diagnostics;
